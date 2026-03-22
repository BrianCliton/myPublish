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
} from "../../core/signing.ts";
import { generateSigningKey, publishKeyList } from "../services/keymanager.ts";
import { publishConfig } from "../services/publisher.ts";
import { canonicalJson } from "../../core/canonical.ts";
import { computeContentHash, computeContentSize } from "../../core/hash.ts";
import { findActiveKey, isKeyAuthorized } from "../../core/keylist.ts";
import type { Config } from "../../core/types.ts";

interface DevStep {
  name: string;
  ok: boolean;
  detail?: string;
}

// In-memory session state — reset on server restart
let devState: {
  rootPublicKey: string;
  adminUserId: string;
  token: string;
} | null = null;

export function createDevRoutes(store: AdminStore): Hono {
  const app = new Hono();

  // GET /dev/status — check initialization
  app.get("/status", (c) => {
    return c.json({ initialized: devState !== null });
  });

  // POST /dev/init — one-click setup:
  //   generate root keypair, create admin user, generate signing key, publish KeyList, issue JWT
  app.post("/init", async (c) => {
    const { publicKey, privateKey } = await generateKeyPair();
    const rootPubB64 = publicKeyToBase64(publicKey);
    const rootPrivB64 = uint8ArrayToBase64(privateKey);
    process.env.ROOT_PRIVATE_KEY = rootPrivB64;

    let adminUser = store.getUserByUsername("dev-admin");
    let adminUserId: string;
    if (!adminUser) {
      adminUserId = crypto.randomUUID();
      const hash = await Bun.password.hash("dev-admin-pass");
      store.createUser(adminUserId, "dev-admin", hash, "admin");
    } else {
      adminUserId = adminUser.id;
    }

    const keyResult = await generateSigningKey(store, 365);
    if (!keyResult.success) {
      return c.json({ error: "生成签名密钥失败: " + keyResult.error }, 500);
    }

    const listResult = await publishKeyList(store, rootPrivB64);
    if (!listResult.success) {
      return c.json({ error: "发布 KeyList 失败: " + listResult.error }, 500);
    }

    const now = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: adminUserId,
      username: "dev-admin",
      role: "admin",
      exp: now + 86400 * 7, // 7-day TTL for dev
      iat: now,
      iss: "publish-server",
      aud: "publish-admin",
    };
    const token = await sign(
      payload as unknown as Record<string, unknown>,
      process.env.JWT_SECRET!,
    );

    devState = { rootPublicKey: rootPubB64, adminUserId, token };

    return c.json({ root_public_key: rootPubB64, token, key_id: keyResult.keyId });
  });

  // POST /dev/quick-publish — create config and publish, bypassing approval workflow
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

    const version = store.getNextConfigVersion();
    const canonical = canonicalJson(body.config as Config);
    store.createConfig(version, canonical, devState.adminUserId, null);

    // Bypass approval workflow — directly mark as approved
    const now = Math.floor(Date.now() / 1000);
    store.updateConfigStatus(version, "approved", { approved_at: now });

    const result = await publishConfig(store, version, activeKey.key_id);
    if (!result.success) {
      return c.json({ error: result.error }, 500);
    }

    return c.json({ version, status: "published", key_id: activeKey.key_id, signature: result.signature });
  });

  // GET /dev/verify — simulate client verification, step by step
  app.get("/verify", async (c) => {
    const steps: DevStep[] = [];
    const add = (name: string, ok: boolean, detail?: string) => steps.push({ name, ok, detail });

    if (!devState) {
      add("检查初始化状态", false, "未初始化，请先点击「一键初始化」");
      return c.json({ steps, config: null });
    }

    // Step 1: Fetch KeyList
    const keyList = store.getLatestKeyList();
    if (!keyList) {
      add("获取 KeyList", false, "数据库中无 KeyList，请重新初始化");
      return c.json({ steps, config: null });
    }
    add("获取 KeyList", true, `list_sequence=${keyList.list_sequence}，共 ${keyList.keys.length} 个密钥`);

    // Step 2: Verify KeyList root signature
    const rootPubKey = base64ToUint8Array(devState.rootPublicKey);
    let keyListValid = false;
    try {
      keyListValid = await verifyKeyList(keyList, rootPubKey);
    } catch { /* leave false */ }
    add("验证 KeyList 根签名", keyListValid, keyListValid ? "根公钥 Ed25519 签名验证通过" : "根签名验证失败");
    if (!keyListValid) return c.json({ steps, config: null });

    // Step 3: Fetch latest published config
    const published = store.getLatestPublishedConfig();
    if (!published) {
      add("获取最新已发布配置", false, "暂无已发布的配置，请先点击「发布配置」");
      return c.json({ steps, config: null });
    }
    add("获取最新已发布配置", true, `version=${published.manifest.version}`);

    // Step 4: Check signing key status
    const now = Math.floor(Date.now() / 1000);
    const keyAuthorized = isKeyAuthorized(keyList, published.manifest.key_id, now);
    const shortKeyId = published.manifest.key_id.substring(0, 28) + "...";
    add(
      "检查签名密钥状态",
      keyAuthorized,
      keyAuthorized ? `${shortKeyId} 状态 active，在有效期内` : `${shortKeyId} 已撤销或过期`,
    );

    // Step 5: Verify manifest signature
    const activeKey = findActiveKey(keyList, published.manifest.key_id);
    let manifestSigValid = false;
    if (activeKey) {
      try {
        const pubKeyBytes = base64ToUint8Array(activeKey.public_key);
        manifestSigValid = await verifyManifest(published.manifest, pubKeyBytes);
      } catch { /* leave false */ }
    }
    add("验证 Manifest 签名", manifestSigValid, manifestSigValid ? "Ed25519 签名验证通过" : "签名验证失败");

    // Step 6: Verify content hash
    const expectedHash = await computeContentHash(published.config);
    const hashMatch = published.manifest.content_hash === expectedHash;
    add(
      "验证内容哈希 (SHA-256)",
      hashMatch,
      hashMatch ? expectedHash.substring(0, 40) + "... 匹配" : "哈希不匹配",
    );

    // Step 7: Verify content size
    const expectedSize = computeContentSize(published.config);
    const sizeMatch = published.manifest.content_size === expectedSize;
    add(
      "验证内容大小",
      sizeMatch,
      sizeMatch ? `${expectedSize} 字节` : `期望 ${expectedSize}，实际 ${published.manifest.content_size}`,
    );

    // Step 8: Check expiry
    const notExpired = published.manifest.expires_at > now;
    const expiryDate = new Date(published.manifest.expires_at * 1000).toLocaleDateString("zh-CN");
    add("检查过期时间", notExpired, notExpired ? `有效期至 ${expiryDate}` : "已过期");

    const allPassed = steps.every((s) => s.ok);
    if (allPassed) {
      add("验证完成", true, "所有步骤通过，配置可信任");
    }

    return c.json({ steps, config: allPassed ? published.config : null });
  });

  return app;
}
