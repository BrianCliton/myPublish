import { describe, expect, test } from "bun:test";
import { computeContentHash, computeContentSize } from "../../src/core/hash.ts";
import { findActiveKey, isKeyAuthorized, validateKeyList } from "../../src/core/keylist.ts";
import {
  generateKeyPair,
  publicKeyToBase64,
  signKeyList,
  signManifest,
} from "../../src/core/signing.ts";
import type {
  Config,
  KeyList,
  UnsignedKeyList,
  UnsignedManifest,
} from "../../src/core/types.ts";
import { validateManifestAndConfig } from "../../src/core/validation.ts";

// Helper to build a complete valid test fixture
async function buildFixture() {
  const rootKp = await generateKeyPair();
  const signingKp = await generateKeyPair();
  const now = Math.floor(Date.now() / 1000);

  const config: Config = {
    endpoints: { api: "https://api.example.com" },
    features: { dark_mode: true },
  };

  const unsignedKeyList: UnsignedKeyList = {
    version: 1,
    list_sequence: 1,
    timestamp: now,
    expires_at: now + 86400,
    keys: [
      {
        key_id: "signing-key-1",
        public_key: publicKeyToBase64(signingKp.publicKey),
        status: "active",
        not_before: now - 3600,
        not_after: now + 86400,
      },
    ],
  };

  const keyList = await signKeyList(unsignedKeyList, rootKp.privateKey);

  const contentHash = await computeContentHash(config);
  const contentSize = computeContentSize(config);

  const unsignedManifest: UnsignedManifest = {
    version: 1,
    content_hash: contentHash,
    content_size: contentSize,
    key_id: "signing-key-1",
    timestamp: now,
    expires_at: now + 3600,
  };

  const manifest = await signManifest(unsignedManifest, signingKp.privateKey);

  return { rootKp, signingKp, config, keyList, manifest, now };
}

// --- KeyList Tests ---

describe("validateKeyList", () => {
  test("validates a correct key list", async () => {
    const { rootKp, keyList } = await buildFixture();
    const result = await validateKeyList(keyList, rootKp.publicKey);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("rejects key list with invalid root signature", async () => {
    const { keyList } = await buildFixture();
    const wrongKp = await generateKeyPair();
    const result = await validateKeyList(keyList, wrongKp.publicKey);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("root signature");
  });

  test("rejects key list with duplicate key_ids", async () => {
    const rootKp = await generateKeyPair();
    const now = Math.floor(Date.now() / 1000);
    const sigKp = await generateKeyPair();

    const unsignedKeyList: UnsignedKeyList = {
      version: 1,
      list_sequence: 1,
      timestamp: now,
      expires_at: now + 86400,
      keys: [
        {
          key_id: "dup",
          public_key: publicKeyToBase64(sigKp.publicKey),
          status: "active",
          not_before: now - 3600,
          not_after: now + 86400,
        },
        {
          key_id: "dup",
          public_key: publicKeyToBase64(sigKp.publicKey),
          status: "active",
          not_before: now - 3600,
          not_after: now + 86400,
        },
      ],
    };

    const keyList = await signKeyList(unsignedKeyList, rootKp.privateKey);
    const result = await validateKeyList(keyList, rootKp.publicKey);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Duplicate");
  });

  test("rejects revoked key without revoked_at", async () => {
    const rootKp = await generateKeyPair();
    const sigKp = await generateKeyPair();
    const now = Math.floor(Date.now() / 1000);

    const unsignedKeyList: UnsignedKeyList = {
      version: 1,
      list_sequence: 1,
      timestamp: now,
      expires_at: now + 86400,
      keys: [
        {
          key_id: "revoked-key",
          public_key: publicKeyToBase64(sigKp.publicKey),
          status: "revoked",
          not_before: now - 3600,
          not_after: now + 86400,
        },
      ],
    };

    const keyList = await signKeyList(unsignedKeyList, rootKp.privateKey);
    const result = await validateKeyList(keyList, rootKp.publicKey);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("revoked_at");
  });
});

describe("findActiveKey", () => {
  test("finds active key by id", async () => {
    const { keyList } = await buildFixture();
    const key = findActiveKey(keyList, "signing-key-1");
    expect(key).toBeDefined();
    expect(key!.key_id).toBe("signing-key-1");
  });

  test("returns undefined for missing key", async () => {
    const { keyList } = await buildFixture();
    const key = findActiveKey(keyList, "nonexistent");
    expect(key).toBeUndefined();
  });
});

describe("isKeyAuthorized", () => {
  test("returns true for active key within validity period", async () => {
    const { keyList, now } = await buildFixture();
    expect(isKeyAuthorized(keyList, "signing-key-1", now)).toBe(true);
  });

  test("returns false for key before not_before", async () => {
    const { keyList, now } = await buildFixture();
    expect(isKeyAuthorized(keyList, "signing-key-1", now - 7200)).toBe(false);
  });

  test("returns false for key after not_after", async () => {
    const { keyList, now } = await buildFixture();
    expect(isKeyAuthorized(keyList, "signing-key-1", now + 100000)).toBe(false);
  });

  test("returns false for nonexistent key", async () => {
    const { keyList, now } = await buildFixture();
    expect(isKeyAuthorized(keyList, "nope", now)).toBe(false);
  });
});

// --- Full Validation Pipeline Tests ---

describe("validateManifestAndConfig", () => {
  test("validates correct manifest and config", async () => {
    const { manifest, config, keyList, rootKp, now } = await buildFixture();
    const result = await validateManifestAndConfig(
      manifest, config, keyList, rootKp.publicKey, now,
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("rejects expired manifest", async () => {
    const { manifest, config, keyList, rootKp, now } = await buildFixture();
    const result = await validateManifestAndConfig(
      manifest, config, keyList, rootKp.publicKey, now + 7200,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("expired"))).toBe(true);
  });

  test("rejects wrong content hash", async () => {
    const { manifest, keyList, rootKp, now, signingKp } = await buildFixture();
    const differentConfig: Config = { features: { other: false } };

    const result = await validateManifestAndConfig(
      manifest, differentConfig, keyList, rootKp.publicKey, now,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("hash mismatch"))).toBe(true);
  });

  test("rejects unauthorized key_id", async () => {
    const { config, keyList, rootKp, now, signingKp } = await buildFixture();

    const contentHash = await computeContentHash(config);
    const contentSize = computeContentSize(config);

    const unsignedManifest: UnsignedManifest = {
      version: 1,
      content_hash: contentHash,
      content_size: contentSize,
      key_id: "unknown-key",
      timestamp: now,
      expires_at: now + 3600,
    };
    const manifest = await signManifest(unsignedManifest, signingKp.privateKey);

    const result = await validateManifestAndConfig(
      manifest, config, keyList, rootKp.publicKey, now,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("not authorized"))).toBe(true);
  });

  test("rejects invalid root signature on key list", async () => {
    const { manifest, config, keyList, now } = await buildFixture();
    const wrongKp = await generateKeyPair();

    const result = await validateManifestAndConfig(
      manifest, config, keyList, wrongKp.publicKey, now,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("root signature"))).toBe(true);
  });

  test("rejects tampered manifest signature", async () => {
    const { manifest, config, keyList, rootKp, now } = await buildFixture();
    const tampered = { ...manifest, content_size: manifest.content_size + 1 };

    const result = await validateManifestAndConfig(
      tampered, config, keyList, rootKp.publicKey, now,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
