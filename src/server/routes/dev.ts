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
  raw?: unknown;
}

let devState: {
  rootPublicKey: string;
  rootPrivateKey: string;
  adminUserId: string;
  reviewerUserId: string;
  publisherToken: string;
  reviewerToken: string;
  signingKeyId: string;
  signingPublicKey: string;
  signingPrivateKey: string;
} | null = null;

async function makeToken(userId: string, username: string, role: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: userId,
    username,
    role,
    exp: now + 86400 * 7,
    iat: now,
    iss: "publish-server",
    aud: "publish-admin",
  };
  return sign(payload as unknown as Record<string, unknown>, process.env.JWT_SECRET!);
}

export function createDevRoutes(store: AdminStore): Hono {
  const app = new Hono();

  app.get("/status", (c) => {
    return c.json({ initialized: devState !== null });
  });

  // POST /dev/init — creates publisher + reviewer users, keypairs, KeyList
  app.post("/init", async (c) => {
    // Root keypair
    const { publicKey: rootPub, privateKey: rootPriv } = await generateKeyPair();
    const rootPubB64 = uint8ArrayToBase64(rootPub);
    const rootPrivB64 = uint8ArrayToBase64(rootPriv);
    process.env.ROOT_PRIVATE_KEY = rootPrivB64;

    // Publisher user (admin role — can create, submit, publish)
    let publisher = store.getUserByUsername("dev-publisher");
    let publisherId: string;
    if (!publisher) {
      publisherId = crypto.randomUUID();
      const hash = await Bun.password.hash("dev-pass");
      store.createUser(publisherId, "dev-publisher", hash, "admin");
    } else {
      publisherId = publisher.id;
    }

    // Reviewer user (reviewer role — can approve/reject)
    let reviewer = store.getUserByUsername("dev-reviewer");
    let reviewerId: string;
    if (!reviewer) {
      reviewerId = crypto.randomUUID();
      const hash = await Bun.password.hash("dev-pass");
      store.createUser(reviewerId, "dev-reviewer", hash, "reviewer");
    } else {
      reviewerId = reviewer.id;
    }

    // Signing keypair
    const keyResult = await generateSigningKey(store, 365);
    if (!keyResult.success) {
      return c.json({ error: "生成签名密钥失败: " + keyResult.error }, 500);
    }
    const signingKeyRow = store.getSigningKey(keyResult.keyId!);
    const signingPrivBytes = await decryptPrivateKey(signingKeyRow!.private_key_enc);
    const signingPrivB64 = uint8ArrayToBase64(signingPrivBytes);

    // Publish KeyList
    const listResult = await publishKeyList(store, rootPrivB64);
    if (!listResult.success) {
      return c.json({ error: "发布 KeyList 失败: " + listResult.error }, 500);
    }

    const publisherToken = await makeToken(publisherId, "dev-publisher", "admin");
    const reviewerToken = await makeToken(reviewerId, "dev-reviewer", "reviewer");

    devState = {
      rootPublicKey: rootPubB64,
      rootPrivateKey: rootPrivB64,
      adminUserId: publisherId,
      reviewerUserId: reviewerId,
      publisherToken,
      reviewerToken,
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
      publisher_token: publisherToken,
      reviewer_token: reviewerToken,
    });
  });

  // POST /dev/sign-publish/:version — sign and publish an approved config, returns full steps
  app.post("/sign-publish/:version", async (c) => {
    if (!devState) return c.json({ error: "未初始化" }, 400);

    const version = parseInt(c.req.param("version"), 10);
    const config = store.getConfigDetail(version);
    if (!config) return c.json({ error: "配置不存在" }, 404);
    if (config.status !== "approved") {
      return c.json({ error: `当前状态为 ${config.status}，必须先审批通过` }, 400);
    }

    const keys = store.listSigningKeys();
    const activeKey = keys.find((k) => k.status === "active");
    if (!activeKey) return c.json({ error: "没有可用签名密钥" }, 400);

    const configObj: Config = JSON.parse(config.config_content);
    const canonical = canonicalJson(configObj);
    const contentHash = await computeContentHash(configObj);
    const contentSize = computeContentSize(configObj);
    const now = Math.floor(Date.now() / 1000);

    const unsignedManifest: UnsignedManifest = {
      version,
      content_hash: contentHash,
      content_size: contentSize,
      key_id: activeKey.key_id,
      timestamp: now,
      expires_at: now + 86400 * 30,
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

  // POST /dev/sign — manually sign arbitrary text
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
      valid = await verifyAsync(
        base64ToUint8Array(body.signature),
        new TextEncoder().encode(body.data),
        base64ToUint8Array(body.public_key),
      );
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }
    return c.json({ valid, error: errorMsg || undefined });
  });

  // GET /dev/verify — full client-side verification simulation
  app.get("/verify", async (c) => {
    const steps: DevStep[] = [];
    const add = (name: string, ok: boolean, detail?: string, raw?: unknown) =>
      steps.push({ name, ok, detail, raw });

    if (!devState) {
      add("检查初始化状态", false, "未初始化，请先点击「一键初始化」");
      return c.json({ steps, config: null });
    }

    const keyList = store.getLatestKeyList();
    if (!keyList) {
      add("获取 KeyList", false, "数据库中无 KeyList");
      return c.json({ steps, config: null });
    }
    add("获取 KeyList", true,
      `list_sequence=${keyList.list_sequence}，${keyList.keys.length} 个密钥`,
      { list_sequence: keyList.list_sequence, keys_count: keyList.keys.length },
    );

    const rootPubKey = base64ToUint8Array(devState.rootPublicKey);
    let keyListValid = false;
    try { keyListValid = await verifyKeyList(keyList, rootPubKey); } catch { /* false */ }
    add("验证 KeyList 根签名", keyListValid,
      keyListValid ? "✓ Ed25519 验证通过" : "✗ 签名无效",
      { root_public_key: devState.rootPublicKey, root_signature: keyList.root_signature },
    );
    if (!keyListValid) return c.json({ steps, config: null });

    const published = store.getLatestPublishedConfig();
    if (!published) {
      add("获取最新已发布配置", false, "暂无已发布的配置");
      return c.json({ steps, config: null });
    }
    add("获取最新已发布配置", true, `version=${published.manifest.version}`, published.manifest);

    const now = Math.floor(Date.now() / 1000);
    const keyAuthorized = isKeyAuthorized(keyList, published.manifest.key_id, now);
    const matchedKey = keyList.keys.find((k) => k.key_id === published.manifest.key_id);
    add("检查签名密钥状态", keyAuthorized,
      keyAuthorized ? "active，在有效期内" : "已撤销或过期",
      matchedKey ?? { key_id: published.manifest.key_id, status: "not found" },
    );

    const activeKey = findActiveKey(keyList, published.manifest.key_id);
    let manifestSigValid = false;
    if (activeKey) {
      try {
        manifestSigValid = await verifyManifest(published.manifest, base64ToUint8Array(activeKey.public_key));
      } catch { /* false */ }
    }
    add("验证 Manifest 签名", manifestSigValid,
      manifestSigValid ? "✓ Ed25519 验证通过" : "✗ 签名无效",
      { signing_public_key: activeKey?.public_key, signature: published.manifest.signature },
    );

    const expectedHash = await computeContentHash(published.config);
    const hashMatch = published.manifest.content_hash === expectedHash;
    add("验证内容哈希 (SHA-256)", hashMatch,
      hashMatch ? "匹配" : "不匹配",
      { expected: expectedHash, actual: published.manifest.content_hash },
    );

    const expectedSize = computeContentSize(published.config);
    const sizeMatch = published.manifest.content_size === expectedSize;
    add("验证内容大小", sizeMatch, `${expectedSize} 字节`,
      { expected: expectedSize, actual: published.manifest.content_size },
    );

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
