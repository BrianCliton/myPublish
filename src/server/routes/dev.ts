/**
 * Dev-only routes — NEVER expose in production.
 * Mounted only when DEV_UI=true.
 */
import { Hono } from "hono";
import { sign } from "hono/jwt";
import type { AdminStore } from "../db/admin-store.ts";
import type { JwtPayload } from "../middleware/auth.ts";
import {
  generateKeyPair,
  uint8ArrayToBase64,
  base64ToUint8Array,
  verifyKeyList,
  verifyManifest,
  signManifest,
} from "../../core/signing.ts";
import { generateSigningKey, publishKeyList, decryptPrivateKey } from "../services/keymanager.ts";
import { publishConfig } from "../services/publisher.ts";
import { canonicalJson } from "../../core/canonical.ts";
import { computeContentHash, computeContentSize } from "../../core/hash.ts";
import { findActiveKey, isKeyAuthorized } from "../../core/keylist.ts";
import { computeDiff } from "../../core/diff.ts";
import type { Config, UnsignedManifest } from "../../core/types.ts";
import { ConfigSchema } from "../../core/types.ts";

// ── Preset seed configs ──────────────────────────────────────────────────────

const SEED_V1: Config = {
  update: {
    latest_version: "2.4.0",
    min_version: "2.0.0",
    download_url: "https://cdn.example.com/releases/v2.4.0.pkg",
    sha256: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    release_notes: "性能优化和若干 Bug 修复",
    force: false,
  },
  features: {
    dark_mode: true,
    new_onboarding: false,
    payment_v2: false,
    analytics: true,
  },
  endpoints: {
    api: "https://api.example.com/v2",
    cdn: "https://cdn.example.com",
    support: "https://support.example.com",
    website: "https://www.example.com",
  },
  announcements: [
    {
      id: "ann-2024-01",
      type: "banner",
      title: "欢迎使用新版本",
      content: "v2.4.0 已发布，感谢您的使用！",
      priority: 1,
      expires_at: 1745000000,
    },
  ],
  custom: {
    security: { min_tls: "1.2", cert_pin: "sha256/AAAAAAAABBBBBBBBCCCCCCCCDDDDDDDD" },
    maintenance: { enabled: false, message: "" },
  },
};

// v2: realistic "emergency security update" — many meaningful changes for review
const SEED_V2: Config = {
  update: {
    latest_version: "2.5.0",
    min_version: "2.0.0",
    download_url: "https://cdn.example.com/releases/v2.5.0.pkg",
    sha256: "f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3b2a1f6e5",
    release_notes: "重大安全更新，修复高危漏洞，强烈建议立即升级",
    force: true,                  // ← 改为强制更新
  },
  features: {
    dark_mode: true,
    new_onboarding: true,         // ← 开启新引导流程
    payment_v2: true,             // ← 开启新支付模块
    analytics: true,
    beta_testing: false,          // ← 新增字段
  },
  endpoints: {
    api: "https://api.example.com/v3",   // ← API 升级到 v3
    cdn: "https://cdn.example.com",
    support: "https://support.example.com",
    website: "https://www.example.com",
  },
  announcements: [
    {
      id: "ann-2025-01",
      type: "popup",              // ← banner → popup（更显眼）
      title: "【紧急】安全更新",
      content: "发现严重安全漏洞，请立即升级至 v2.5.0，否则将影响数据安全",
      priority: 10,               // ← 优先级从 1 提升到 10
      expires_at: 1756000000,
    },
  ],
  custom: {
    security: {
      min_tls: "1.3",             // ← TLS 要求提升
      cert_pin: "sha256/XXXXYYYYZZZZZZZZ99999999XXXXXXXX",  // ← 证书更换
    },
    maintenance: { enabled: false, message: "" },
  },
};

// ── Session state ────────────────────────────────────────────────────────────

let devState: {
  rootPublicKey: string;
  rootPrivateKey: string;
  publisherId: string;
  reviewerId: string;
  publisherToken: string;
  reviewerToken: string;
  signingKeyId: string;
  signingPublicKey: string;
  signingPrivateKey: string;
} | null = null;

async function makeToken(userId: string, username: string, role: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: userId, username, role,
    exp: now + 86400 * 7, iat: now,
    iss: "publish-server", aud: "publish-admin",
  };
  return sign(payload as unknown as Record<string, unknown>, process.env.JWT_SECRET!);
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function createDevRoutes(store: AdminStore): Hono {
  const app = new Hono();

  app.get("/status", (c) => c.json({ initialized: devState !== null }));

  // POST /dev/init ─ create users, keypairs, KeyList, then seed v1+v2
  app.post("/init", async (c) => {
    const { publicKey: rootPub, privateKey: rootPriv } = await generateKeyPair();
    const rootPubB64 = uint8ArrayToBase64(rootPub);
    const rootPrivB64 = uint8ArrayToBase64(rootPriv);
    process.env.ROOT_PRIVATE_KEY = rootPrivB64;

    // Publisher (admin role)
    let pub = store.getUserByUsername("dev-publisher");
    let publisherId = pub?.id ?? crypto.randomUUID();
    if (!pub) store.createUser(publisherId, "dev-publisher", await Bun.password.hash("dev-pass"), "admin");

    // Reviewer
    let rev = store.getUserByUsername("dev-reviewer");
    let reviewerId = rev?.id ?? crypto.randomUUID();
    if (!rev) store.createUser(reviewerId, "dev-reviewer", await Bun.password.hash("dev-pass"), "reviewer");

    // Signing keypair
    const keyResult = await generateSigningKey(store, 365);
    if (!keyResult.success) return c.json({ error: "生成签名密钥失败: " + keyResult.error }, 500);

    const signingKeyRow = store.getSigningKey(keyResult.keyId!);
    const signingPrivBytes = await decryptPrivateKey(signingKeyRow!.private_key_enc);
    const signingPrivB64 = uint8ArrayToBase64(signingPrivBytes);

    // Publish KeyList
    const listResult = await publishKeyList(store, rootPrivB64);
    if (!listResult.success) return c.json({ error: "发布 KeyList 失败: " + listResult.error }, 500);

    const now = Math.floor(Date.now() / 1000);

    // ── Seed v1: published baseline ──────────────────────────────────────────
    const v1 = store.getNextConfigVersion();
    store.createConfig(v1, canonicalJson(SEED_V1), publisherId, null);
    store.updateConfigStatus(v1, "approved", { approved_at: now });
    await publishConfig(store, v1, keyResult.keyId!);

    // ── Seed v2: pending review (emergency security update) ──────────────────
    const v2 = store.getNextConfigVersion();
    store.createConfig(v2, canonicalJson(SEED_V2), publisherId, v1);
    store.updateConfigStatus(v2, "pending_review", { submitted_at: now });

    const publisherToken = await makeToken(publisherId, "dev-publisher", "admin");
    const reviewerToken  = await makeToken(reviewerId, "dev-reviewer", "reviewer");

    devState = {
      rootPublicKey: rootPubB64, rootPrivateKey: rootPrivB64,
      publisherId, reviewerId,
      publisherToken, reviewerToken,
      signingKeyId: keyResult.keyId!, signingPublicKey: keyResult.publicKey!,
      signingPrivateKey: signingPrivB64,
    };

    return c.json({
      root_public_key: rootPubB64,
      root_private_key: rootPrivB64,
      signing_key_id: keyResult.keyId,
      signing_public_key: keyResult.publicKey,
      signing_private_key: signingPrivB64,
      publisher_token: publisherToken,
      reviewer_token: reviewerToken,
      seeded: { published_version: v1, pending_version: v2 },
      form_preset: SEED_V2,
    });
  });

  // GET /dev/configs/:version/preview ─ full fields + diff + schema validation
  app.get("/configs/:version/preview", (c) => {
    if (!devState) return c.json({ error: "未初始化" }, 400);

    const version = parseInt(c.req.param("version"), 10);
    const row = store.getConfigDetail(version);
    if (!row) return c.json({ error: "配置版本不存在" }, 404);

    const config: Config = JSON.parse(row.config_content);

    // Schema validation via Zod
    const parsed = ConfigSchema.safeParse(config);
    const validationErrors = parsed.success
      ? []
      : parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`);

    // Diff vs current published version
    const published = store.getLatestPublishedConfig();
    const diff = published ? computeDiff(published.config, config) : [];
    const breakingChanges = diff.filter((e) => e.breaking);

    return c.json({
      version,
      status: row.status,
      config,
      validation: { valid: validationErrors.length === 0, errors: validationErrors },
      diff,
      breaking_changes: breakingChanges,
      base_published_version: published?.manifest.version ?? null,
    });
  });

  // POST /dev/sign-publish/:version ─ sign an approved config, return full steps
  app.post("/sign-publish/:version", async (c) => {
    if (!devState) return c.json({ error: "未初始化" }, 400);

    const version = parseInt(c.req.param("version"), 10);
    const row = store.getConfigDetail(version);
    if (!row) return c.json({ error: "配置版本不存在" }, 404);
    if (row.status !== "approved") {
      return c.json({ error: `状态为 ${row.status}，必须先审批通过` }, 400);
    }

    const keys = store.listSigningKeys();
    const activeKey = keys.find((k) => k.status === "active");
    if (!activeKey) return c.json({ error: "没有可用签名密钥" }, 400);

    const configObj: Config = JSON.parse(row.config_content);
    const canonical = canonicalJson(configObj);
    const contentHash = await computeContentHash(configObj);
    const contentSize = computeContentSize(configObj);
    const now = Math.floor(Date.now() / 1000);

    const unsignedManifest: UnsignedManifest = {
      version, content_hash: contentHash, content_size: contentSize,
      key_id: activeKey.key_id, timestamp: now, expires_at: now + 86400 * 30,
    };

    const signingPrivBytes = await decryptPrivateKey(activeKey.private_key_enc);
    const signedManifest = await signManifest(unsignedManifest, signingPrivBytes);

    const result = await publishConfig(store, version, activeKey.key_id);
    if (!result.success) return c.json({ error: result.error }, 500);

    return c.json({
      version,
      status: "published",
      client_payload: { manifest: signedManifest, config: configObj },
      steps: {
        canonical_json: canonical,
        content_hash: contentHash,
        content_size: contentSize,
        unsigned_manifest: unsignedManifest,
        signature: signedManifest.signature,
        signed_manifest: signedManifest,
      },
    });
  });

  // POST /dev/sign ─ manually sign arbitrary text
  app.post("/sign", async (c) => {
    if (!devState) return c.json({ error: "未初始化" }, 400);
    const body = await c.req.json<{ data: string; private_key?: string }>().catch(() => null);
    if (!body?.data) return c.json({ error: "缺少 data 字段" }, 400);

    const privB64 = body.private_key ?? devState.signingPrivateKey;
    const privBytes = base64ToUint8Array(privB64);
    const dataBytes = new TextEncoder().encode(body.data);
    const { signAsync } = await import("@noble/ed25519");
    const sigBytes = await signAsync(dataBytes, privBytes);

    return c.json({
      data: body.data,
      signature: uint8ArrayToBase64(sigBytes),
      private_key_used: privB64.substring(0, 12) + "...",
    });
  });

  // POST /dev/verify-sig ─ manually verify a signature
  app.post("/verify-sig", async (c) => {
    const body = await c.req.json<{ data: string; signature: string; public_key: string }>().catch(() => null);
    if (!body?.data || !body.signature || !body.public_key) {
      return c.json({ error: "缺少 data / signature / public_key" }, 400);
    }
    const { verifyAsync } = await import("@noble/ed25519");
    let valid = false, errorMsg = "";
    try {
      valid = await verifyAsync(
        base64ToUint8Array(body.signature),
        new TextEncoder().encode(body.data),
        base64ToUint8Array(body.public_key),
      );
    } catch (e) { errorMsg = e instanceof Error ? e.message : String(e); }
    return c.json({ valid, error: errorMsg || undefined });
  });

  // GET /dev/verify ─ full client-side verification simulation
  app.get("/verify", async (c) => {
    interface Step { name: string; ok: boolean; detail?: string; raw?: unknown }
    const steps: Step[] = [];
    const add = (name: string, ok: boolean, detail?: string, raw?: unknown) =>
      steps.push({ name, ok, detail, raw });

    if (!devState) {
      add("检查初始化状态", false, "未初始化");
      return c.json({ steps, config: null });
    }

    const keyList = store.getLatestKeyList();
    if (!keyList) {
      add("获取 KeyList", false, "无 KeyList");
      return c.json({ steps, config: null });
    }
    add("获取 KeyList", true, `list_sequence=${keyList.list_sequence}，${keyList.keys.length} 个密钥`,
      { list_sequence: keyList.list_sequence, keys_count: keyList.keys.length });

    const rootPubKey = base64ToUint8Array(devState.rootPublicKey);
    let keyListValid = false;
    try { keyListValid = await verifyKeyList(keyList, rootPubKey); } catch { /**/ }
    add("验证 KeyList 根签名", keyListValid,
      keyListValid ? "✓ Ed25519 验证通过" : "✗ 签名无效",
      { root_public_key: devState.rootPublicKey, root_signature: keyList.root_signature });
    if (!keyListValid) return c.json({ steps, config: null });

    const published = store.getLatestPublishedConfig();
    if (!published) {
      add("获取最新已发布配置", false, "暂无已发布配置");
      return c.json({ steps, config: null });
    }
    add("获取最新已发布配置", true, `version=${published.manifest.version}`, published.manifest);

    const now = Math.floor(Date.now() / 1000);
    const keyAuthorized = isKeyAuthorized(keyList, published.manifest.key_id, now);
    const matchedKey = keyList.keys.find((k) => k.key_id === published.manifest.key_id);
    add("检查签名密钥状态", keyAuthorized,
      keyAuthorized ? "active，在有效期内" : "已撤销或过期", matchedKey);

    const activeKey = findActiveKey(keyList, published.manifest.key_id);
    let manifestSigValid = false;
    if (activeKey) {
      try { manifestSigValid = await verifyManifest(published.manifest, base64ToUint8Array(activeKey.public_key)); }
      catch { /**/ }
    }
    add("验证 Manifest 签名", manifestSigValid,
      manifestSigValid ? "✓ Ed25519 验证通过" : "✗ 签名无效",
      { signing_public_key: activeKey?.public_key, signature: published.manifest.signature });

    const expectedHash = await computeContentHash(published.config);
    const hashMatch = published.manifest.content_hash === expectedHash;
    add("验证内容哈希 (SHA-256)", hashMatch, hashMatch ? "匹配" : "不匹配",
      { expected: expectedHash, actual: published.manifest.content_hash });

    const expectedSize = computeContentSize(published.config);
    const sizeMatch = published.manifest.content_size === expectedSize;
    add("验证内容大小", sizeMatch, `${expectedSize} 字节`,
      { expected: expectedSize, actual: published.manifest.content_size });

    const notExpired = published.manifest.expires_at > now;
    add("检查过期时间", notExpired,
      notExpired
        ? `有效期至 ${new Date(published.manifest.expires_at * 1000).toLocaleString("zh-CN")}`
        : "已过期",
      { expires_at: published.manifest.expires_at, now });

    const allPassed = steps.every((s) => s.ok);
    if (allPassed) add("验证完成", true, "所有步骤通过，配置可信任");

    return c.json({ steps, config: allPassed ? published.config : null });
  });

  return app;
}
