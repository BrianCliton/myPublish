import { describe, test, expect, beforeEach, afterEach } from "bun:test";

process.env.KEY_ENCRYPTION_KEY = "test-encryption-key-for-ci";
process.env.NODE_ENV = "test";

import { AdminStore } from "../../src/server/db/admin-store.ts";
import { submitForReview, approve, reject } from "../../src/server/services/approval.ts";
import {
  encryptPrivateKey,
  decryptPrivateKey,
  generateSigningKey,
  revokeKey,
  publishKeyList,
} from "../../src/server/services/keymanager.ts";
import { publishConfig } from "../../src/server/services/publisher.ts";
import {
  generateKeyPair,
  publicKeyToBase64,
  uint8ArrayToBase64,
  signManifest,
} from "../../src/core/signing.ts";
import { canonicalJson } from "../../src/core/canonical.ts";

describe("Approval Service", () => {
  let store: AdminStore;

  beforeEach(() => {
    store = new AdminStore(":memory:");
    store.runMigrations();
    store.createUser("author", "author", "hash", "publisher");
    store.createUser("reviewer1", "reviewer1", "hash", "reviewer");
    store.createUser("reviewer2", "reviewer2", "hash", "reviewer");
  });

  afterEach(() => {
    store.close();
  });

  describe("submitForReview", () => {
    test("submits draft config", () => {
      store.createConfig(1, '{"features":{}}', "author", null);
      const result = submitForReview(store, 1, "author");
      expect(result.success).toBe(true);
      expect(store.getConfigDetail(1)!.status).toBe("pending_review");
    });

    test("rejects non-draft config", () => {
      store.createConfig(1, '{}', "author", null);
      store.updateConfigStatus(1, "pending_review");
      const result = submitForReview(store, 1, "author");
      expect(result.success).toBe(false);
      expect(result.error).toContain("pending_review");
    });

    test("rejects non-existent config", () => {
      const result = submitForReview(store, 999, "author");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("rejects submission by non-author", () => {
      store.createConfig(1, '{}', "author", null);
      const result = submitForReview(store, 1, "reviewer1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Only the author");
    });
  });

  describe("approve", () => {
    beforeEach(() => {
      store.createConfig(1, '{}', "author", null);
      store.updateConfigStatus(1, "pending_review", { submitted_at: Math.floor(Date.now() / 1000) });
    });

    test("approves with single reviewer (not enough for auto-approve)", () => {
      const result = approve(store, 1, "reviewer1");
      expect(result.success).toBe(true);
      expect(result.autoApproved).toBe(false);
      expect(store.getConfigDetail(1)!.status).toBe("pending_review");
    });

    test("auto-approves when minimum approvals reached (2)", () => {
      approve(store, 1, "reviewer1");
      const result = approve(store, 1, "reviewer2");
      expect(result.success).toBe(true);
      expect(result.autoApproved).toBe(true);
      expect(store.getConfigDetail(1)!.status).toBe("approved");
    });

    test("rejects non-existent config", () => {
      const result = approve(store, 999, "reviewer1");
      expect(result.success).toBe(false);
    });

    test("rejects if not pending_review", () => {
      store.updateConfigStatus(1, "draft");
      const result = approve(store, 1, "reviewer1");
      expect(result.success).toBe(false);
    });

    test("prevents self-approval", () => {
      const result = approve(store, 1, "author");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot approve your own");
    });

    test("prevents duplicate review", () => {
      approve(store, 1, "reviewer1");
      const result = approve(store, 1, "reviewer1");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Already reviewed");
    });
  });

  describe("reject", () => {
    beforeEach(() => {
      store.createConfig(1, '{}', "author", null);
      store.updateConfigStatus(1, "pending_review");
    });

    test("rejects config with comment", () => {
      const result = reject(store, 1, "reviewer1", "needs work");
      expect(result.success).toBe(true);
      expect(store.getConfigDetail(1)!.status).toBe("rejected");
    });

    test("rejects non-existent config", () => {
      const result = reject(store, 999, "reviewer1", "comment");
      expect(result.success).toBe(false);
    });

    test("rejects if not pending_review", () => {
      store.updateConfigStatus(1, "draft");
      const result = reject(store, 1, "reviewer1", "comment");
      expect(result.success).toBe(false);
    });

    test("prevents self-rejection", () => {
      const result = reject(store, 1, "author", "bad");
      expect(result.success).toBe(false);
    });

    test("prevents duplicate review", () => {
      approve(store, 1, "reviewer1");
      const result = reject(store, 1, "reviewer1", "changed mind");
      expect(result.success).toBe(false);
    });
  });
});

describe("KeyManager Service", () => {
  let store: AdminStore;

  beforeEach(() => {
    store = new AdminStore(":memory:");
    store.runMigrations();
  });

  afterEach(() => {
    store.close();
  });

  describe("encrypt/decryptPrivateKey", () => {
    test("round-trips correctly", async () => {
      const { privateKey } = await generateKeyPair();
      const encrypted = await encryptPrivateKey(privateKey);
      expect(encrypted.startsWith("aes:")).toBe(true);
      const decrypted = await decryptPrivateKey(encrypted);
      expect(uint8ArrayToBase64(decrypted)).toBe(uint8ArrayToBase64(privateKey));
    });

    test("rejects non-aes-prefixed keys", async () => {
      const { privateKey } = await generateKeyPair();
      const raw = uint8ArrayToBase64(privateKey);
      expect(decryptPrivateKey(raw)).rejects.toThrow("Unsupported key format");
    });
  });

  describe("generateSigningKey", () => {
    test("generates and stores a signing key", async () => {
      const result = await generateSigningKey(store);
      expect(result.success).toBe(true);
      expect(result.keyId).toBeDefined();
      expect(result.publicKey).toBeDefined();

      const stored = store.getSigningKey(result.keyId!);
      expect(stored).not.toBeNull();
      expect(stored!.status).toBe("active");
      expect(stored!.public_key).toBe(result.publicKey);
    });

    test("generates unique key IDs", async () => {
      const r1 = await generateSigningKey(store);
      const r2 = await generateSigningKey(store);
      expect(r1.keyId).not.toBe(r2.keyId);
    });
  });

  describe("revokeKey", () => {
    test("revokes an active key", async () => {
      const gen = await generateSigningKey(store);
      const result = revokeKey(store, gen.keyId!);
      expect(result.success).toBe(true);
      expect(store.getSigningKey(gen.keyId!)!.status).toBe("revoked");
    });

    test("fails for non-existent key", () => {
      const result = revokeKey(store, "nope");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    test("fails for already revoked key", async () => {
      const gen = await generateSigningKey(store);
      revokeKey(store, gen.keyId!);
      const result = revokeKey(store, gen.keyId!);
      expect(result.success).toBe(false);
      expect(result.error).toContain("already revoked");
    });
  });

  describe("publishKeyList", () => {
    test("publishes a key list signed by root key", async () => {
      const rootPair = await generateKeyPair();
      const rootPrivBase64 = uint8ArrayToBase64(rootPair.privateKey);

      await generateSigningKey(store);
      const result = await publishKeyList(store, rootPrivBase64);
      expect(result.success).toBe(true);
      expect(result.listSequence).toBe(1);

      const kl = store.getLatestKeyList();
      expect(kl).not.toBeNull();
      expect(kl!.keys.length).toBeGreaterThan(0);
    });

    test("fails when no signing keys exist", async () => {
      const rootPair = await generateKeyPair();
      const rootPrivBase64 = uint8ArrayToBase64(rootPair.privateKey);
      const result = await publishKeyList(store, rootPrivBase64);
      expect(result.success).toBe(false);
      expect(result.error).toContain("No signing keys");
    });

    test("increments list sequence", async () => {
      const rootPair = await generateKeyPair();
      const rootPrivBase64 = uint8ArrayToBase64(rootPair.privateKey);

      await generateSigningKey(store);
      await publishKeyList(store, rootPrivBase64);
      const result2 = await publishKeyList(store, rootPrivBase64);
      expect(result2.listSequence).toBe(2);
    });
  });
});

describe("Publisher Service", () => {
  let store: AdminStore;

  beforeEach(async () => {
    store = new AdminStore(":memory:");
    store.runMigrations();
    store.createUser("author", "author", "hash", "publisher");
  });

  afterEach(() => {
    store.close();
  });

  test("publishes an approved config", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const pubBase64 = publicKeyToBase64(publicKey);
    const encPriv = await encryptPrivateKey(privateKey);
    const now = Math.floor(Date.now() / 1000);

    store.createSigningKey("k1", pubBase64, encPriv, now - 3600, now + 86400);
    store.createConfig(1, canonicalJson({ features: { dark_mode: true } }), "author", null);
    store.updateConfigStatus(1, "approved", { approved_at: now });

    const result = await publishConfig(store, 1, "k1");
    expect(result.success).toBe(true);
    expect(result.version).toBe(1);
    expect(result.signature).toBeDefined();

    const config = store.getConfigDetail(1);
    expect(config!.status).toBe("published");
    expect(config!.content_hash).toMatch(/^sha256:/);
  });

  test("rejects non-approved config", async () => {
    store.createConfig(1, '{}', "author", null);
    const result = await publishConfig(store, 1, "k1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("draft");
  });

  test("rejects non-existent config", async () => {
    const result = await publishConfig(store, 999, "k1");
    expect(result.success).toBe(false);
  });

  test("rejects revoked signing key", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const pubBase64 = publicKeyToBase64(publicKey);
    const encPriv = await encryptPrivateKey(privateKey);
    const now = Math.floor(Date.now() / 1000);

    store.createSigningKey("k1", pubBase64, encPriv, now - 3600, now + 86400);
    store.revokeSigningKey("k1");

    store.createConfig(1, '{}', "author", null);
    store.updateConfigStatus(1, "approved", { approved_at: now });

    const result = await publishConfig(store, 1, "k1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("revoked");
  });

  test("rejects non-existent signing key", async () => {
    const now = Math.floor(Date.now() / 1000);
    store.createConfig(1, '{}', "author", null);
    store.updateConfigStatus(1, "approved", { approved_at: now });

    const result = await publishConfig(store, 1, "nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
