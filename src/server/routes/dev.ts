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
  publicKeyToBase64,
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
import type { Config, UnsignedManifest } from "../../core/types.ts";

interface DevStep {
  name: string;
  ok: boolean;
  detail?: string;
  raw?: unknown;   // actual data at this step (shown in UI)
}

// In-memory session state — reset on server restart
let devState: {
  rootPublicKey: string;
  rootPrivateKey: string;
  adminUserId: string;
  token: string;
  signingKeyId: string;
  signingPublicKey: string;
  signingPrivateKey: string;
} | null = null;

export function createDevRoutes(store: AdminStore): Hono {
  const app = new Hono();

  // GET /dev/status
  app.get("/status", (c) => {
    return c.json({ initialized: devState !== null });
  });

  // POST /dev/init — full one-click setup, returns ALL keypairs
  app.post("/init", async (c) => {
    // 1. Generate root keypair
    const { publicKey: rootPub, privateKey: rootPriv } = await generateKeyPair();
    const rootPubB64 = uint8ArrayToBase64(rootPub);
    const rootPrivB64 = uint8ArrayToBase64(rootPriv);
    process.env.ROOT_PRIVATE_KEY = rootPrivB64;

    // 2. Create admin user
    let adminUser = store.getUserByUsername("dev-admin");
    let adminUserId: string;
    if (!adminUser) {
      adminUserId = crypto.randomUUID();
      const hash = await Bun.password.hash("dev-admin-pass");
      store.createUser(adminUserId, "dev-admin", hash, "admin");
    } else {
      adminUserId = adminUser.id;
    }

    // 3. Generate signing keypair (stored encrypted in DB)
    const keyResult = await generateSigningKey(store, 365);
    if (!keyResult.success) {
      return c.json({ error: "生成签名密钥失败: " + keyResult.error }, 500);
    }

    // 4. Decrypt signing private key for display
    const signingKeyRow = store.getSigningKey(keyResult.keyId!);
    const signingPrivBytes = await decryptPrivateKey(signingKeyRow!.private_key_enc);
    const signingPrivB64 = uint8ArrayToBase64(signingPrivBytes);

    // 5. Publish KeyList (signed by root key)
    const listResult = await publishKeyList(store, rootPrivB64);
    if (!listResult.success) {
      return c.json({ error: "发布 KeyList 失败: " + listResult.error }, 500);
    }

    // 6. Issue 7-day JWT
    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: adminUserId,
      username: "dev-admin",
      role: "admin",
      exp: now + 86400 * 7,
      iat: now,
      iss: "publish-server",
      aud: "publish-admin",
    };
    const token = await sign(
      payload as unknown as Record<string, unknown>,
      process.env.JWT_SECRET!,
    );

    devState = {
      rootPublicKey: rootPubB64,
      rootPrivateKey: rootPrivB64,
      adminUserId,
      token,
      signingKeyId: keyResult.keyId!,
      signingPublicKey: keyResult.publicKey!,
      signingPrivateKey: signingPrivB64,
    };

    return c.json({
      root_public_key: rootPubB64,
      root_private_key: rootPrivB64,
      signing_key_id: keyResult.keyId,
      signing_public_key: keyResult.publicKey,
      signing_private_key: signingPrivB64,
      token,
    });
  });

  // POST /dev/quick-publish — publish config, returns intermediate steps
  app.post("/quick-publish", async (c) => {
    if (!devState) {
      return c.json({ error: "未初始化，请先点击「一键初始化」" }, 400);
    }

    const body = await c.req.json<{ config: Record<string, unknown> }>().catch(() => null);
    if (!body?.config) {
      return c.json({ error: "缺少 config 字段" }, 400);
    }

    const keys = store.listSigningKeys();
    const activeKey = keys.find((k) => k.status === "active");
    if (!activeKey) {
      return c.json({ error: "没有可用的签名密钥，请重新初始化" }, 400);
    }

    // Step A: canonicalize
    const configObj = body.config as Config;
    const canonical = canonicalJson(configObj);

    // Step B: compute hash & size
    const contentHash = await computeContentHash(configObj);
    const contentSize = computeContentSize(configObj);

    // Step C: build unsigned manifest
    const version = store.getNextConfigVersion();
    const now = Math.floor(Date.now() / 1000);
    const unsignedManifest: UnsignedManifest = {
      version,
      content_hash: contentHash,
      content_size: contentSize,
      key_id: activeKey.key_id,
      timestamp: now,
      expires_at: now + 86400 * 30,
    };

    // Step D: sign manifest
    const signingPrivBytes = await decryptPrivateKey(activeKey.private_key_enc);
    const signedManifest = await signManifest(unsignedManifest, signingPrivBytes);

    // Save to DB (bypass approval)
    store.createConfig(version, canonical, devState.adminUserId, null);
    store.updateConfigStatus(version, "approved", { approved_at: now });
    const result = await publishConfig(store, version, activeKey.key_id);
    if (!result.success) {
      return c.json({ error: result.error }, 500);
    }

    return c.json({
      version,
      status: "published",
      // Full payload exactly as the client receives it from GET /v1/config/latest
      client_payload: {
        manifest: signedManifest,
        config: configObj,
      },
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

  // POST /dev/sign — manually sign arbitrary text with signing private key
  app.post("/sign", async (c) => {
    if (!devState) return c.json({ error: "未初始化" }, 400);
    const body = await c.req.json<{ data: string; private_key?: string }>().catch(() => null);
    if (!body?.data) return c.json({ error: "缺少 data 字段" }, 400);

    const privB64 = body.private_key ?? devState.signingPrivateKey;
    const privBytes = base64ToUint8Array(privB64);
    const dataBytes = new TextEncoder().encode(body.data);

    const { signAsync } = await import("@noble/ed25519");
    const sigBytes = await signAsync(dataBytes, privBytes);
    const signature = uint8ArrayToBase64(sigBytes);

    return c.json({ data: body.data, signature, private_key_used: privB64.substring(0, 12) + "..." });
  });

  // POST /dev/verify-sig — manually verify a signature
  app.post("/verify-sig", async (c) => {
    const body = await c.req.json<{ data: string; signature: string; public_key: string }>().catch(() => null);
    if (!body?.data || !body.signature || !body.public_key) {
      return c.json({ error: "缺少 data / signature / public_key" }, 400);
    }

    const { verifyAsync } = await import("@noble/ed25519");
    let valid = false;
    let errorMsg = "";
    try {
      const dataBytes = new TextEncoder().encode(body.data);
      const sigBytes = base64ToUint8Array(body.signature);
      const pubBytes = base64ToUint8Array(body.public_key);
      valid = await verifyAsync(sigBytes, dataBytes, pubBytes);
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }

    return c.json({ valid, error: errorMsg || undefined });
  });

  // GET /dev/verify — full client-side verification simulation with raw data
  app.get("/verify", async (c) => {
    const steps: DevStep[] = [];
    const add = (name: string, ok: boolean, detail?: string, raw?: unknown) =>
      steps.push({ name, ok, detail, raw });

    if (!devState) {
      add("检查初始化状态", false, "未初始化，请先点击「一键初始化」");
      return c.json({ steps, config: null });
    }

    // Step 1: Fetch KeyList
    const keyList = store.getLatestKeyList();
    if (!keyList) {
      add("获取 KeyList", false, "数据库中无 KeyList");
      return c.json({ steps, config: null });
    }
    add("获取 KeyList", true,
      `list_sequence=${keyList.list_sequence}，${keyList.keys.length} 个密钥`,
      { list_sequence: keyList.list_sequence, keys_count: keyList.keys.length, expires_at: keyList.expires_at },
    );

    // Step 2: Verify KeyList root signature
    const rootPubKey = base64ToUint8Array(devState.rootPublicKey);
    let keyListValid = false;
    try { keyListValid = await verifyKeyList(keyList, rootPubKey); } catch { /* false */ }
    add("验证 KeyList 根签名（根公钥）", keyListValid,
      keyListValid ? "✓ Ed25519 验证通过" : "✗ 签名无效",
      { root_public_key: devState.rootPublicKey, root_signature: keyList.root_signature },
    );
    if (!keyListValid) return c.json({ steps, config: null });

    // Step 3: Fetch latest published config
    const published = store.getLatestPublishedConfig();
    if (!published) {
      add("获取最新已发布配置", false, "暂无已发布的配置，请先发布");
      return c.json({ steps, config: null });
    }
    add("获取最新已发布配置", true, `version=${published.manifest.version}`, published.manifest);

    // Step 4: Check signing key status
    const now = Math.floor(Date.now() / 1000);
    const keyAuthorized = isKeyAuthorized(keyList, published.manifest.key_id, now);
    const matchedKey = keyList.keys.find((k) => k.key_id === published.manifest.key_id);
    add("检查签名密钥状态", keyAuthorized,
      keyAuthorized ? "active，在有效期内" : "已撤销或过期",
      matchedKey ?? { key_id: published.manifest.key_id, status: "not found" },
    );

    // Step 5: Verify manifest signature
    const activeKey = findActiveKey(keyList, published.manifest.key_id);
    let manifestSigValid = false;
    if (activeKey) {
      try {
        const pubKeyBytes = base64ToUint8Array(activeKey.public_key);
        manifestSigValid = await verifyManifest(published.manifest, pubKeyBytes);
      } catch { /* false */ }
    }
    add("验证 Manifest 签名（签名公钥）", manifestSigValid,
      manifestSigValid ? "✓ Ed25519 验证通过" : "✗ 签名无效",
      { signing_public_key: activeKey?.public_key, signature: published.manifest.signature },
    );

    // Step 6: Verify content hash
    const expectedHash = await computeContentHash(published.config);
    const hashMatch = published.manifest.content_hash === expectedHash;
    add("验证内容哈希 (SHA-256)", hashMatch,
      hashMatch ? "匹配" : "不匹配",
      { expected: expectedHash, actual: published.manifest.content_hash },
    );

    // Step 7: Verify content size
    const expectedSize = computeContentSize(published.config);
    const sizeMatch = published.manifest.content_size === expectedSize;
    add("验证内容大小", sizeMatch,
      `${expectedSize} 字节`,
      { expected: expectedSize, actual: published.manifest.content_size },
    );

    // Step 8: Check expiry
    const notExpired = published.manifest.expires_at > now;
    const expiryDate = new Date(published.manifest.expires_at * 1000).toLocaleString("zh-CN");
    add("检查过期时间", notExpired,
      notExpired ? `有效期至 ${expiryDate}` : "已过期",
      { expires_at: published.manifest.expires_at, now },
    );

    const allPassed = steps.every((s) => s.ok);
    if (allPassed) add("验证完成", true, "所有步骤通过，配置可信任");

    return c.json({ steps, config: allPassed ? published.config : null });
  });

  return app;
}
