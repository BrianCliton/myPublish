import { describe, test, expect, beforeAll, afterAll } from "bun:test";

process.env.NODE_ENV = "test";

import { Hono } from "hono";
import { Store } from "../../src/server/db/store.ts";
import { createApp } from "../../src/server/index.ts";
import { canonicalJson } from "../../src/core/canonical.ts";
import { computeContentHash, computeContentSize } from "../../src/core/hash.ts";
import {
  generateKeyPair,
  publicKeyToBase64,
  signManifest,
  signKeyList,
} from "../../src/core/signing.ts";
import type { Config, UnsignedManifest, UnsignedKeyList } from "../../src/core/types.ts";

// --- Test helpers ---

async function seedTestData(store: Store) {
  const db = store.db;

  // Create a user
  db.run(
    `INSERT INTO users (id, username, password_hash, role)
     VALUES (?, ?, ?, ?)`,
    ["user-1", "admin", "hashed_password", "admin"]
  );

  // Generate signing key pair
  const { publicKey, privateKey } = await generateKeyPair();
  const pubKeyBase64 = publicKeyToBase64(publicKey);
  const keyId = "key-001";

  const now = Math.floor(Date.now() / 1000);

  // Store signing key
  db.run(
    `INSERT INTO signing_keys (key_id, public_key, private_key_enc, status, not_before, not_after)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [keyId, pubKeyBase64, "encrypted_private_key", "active", now - 3600, now + 86400 * 365]
  );

  // Create and sign a KeyList
  const { publicKey: rootPubKey, privateKey: rootPrivKey } = await generateKeyPair();
  const rootPubBase64 = publicKeyToBase64(rootPubKey);

  const unsignedKeyList: UnsignedKeyList = {
    version: 1,
    list_sequence: 1,
    timestamp: now,
    expires_at: now + 86400 * 30,
    keys: [
      {
        key_id: keyId,
        public_key: pubKeyBase64,
        status: "active" as const,
        not_before: now - 3600,
        not_after: now + 86400 * 365,
      },
    ],
  };

  const signedKeyList = await signKeyList(unsignedKeyList, rootPrivKey);

  // Store key list - content excludes root_signature
  const { root_signature: _rootSig, ...keyListContent } = signedKeyList;
  db.run(
    `INSERT INTO key_lists (list_sequence, content, root_signature)
     VALUES (?, ?, ?)`,
    [signedKeyList.list_sequence, JSON.stringify(keyListContent), signedKeyList.root_signature]
  );

  // Create test config
  const config: Config = {
    update: {
      latest_version: "2.0.0",
      min_version: "1.0.0",
      download_url: "https://example.com/download",
      sha256: "abc123def456",
    },
    features: {
      dark_mode: true,
      beta_features: false,
    },
    endpoints: {
      api: "https://api.example.com",
    },
  };

  const contentHash = await computeContentHash(config);
  const contentSize = computeContentSize(config);

  // Sign the manifest
  const unsignedManifest: UnsignedManifest = {
    version: 1,
    content_hash: contentHash,
    content_size: contentSize,
    key_id: keyId,
    timestamp: now,
    expires_at: now + 86400 * 30,
  };

  const signedManifest = await signManifest(unsignedManifest, privateKey);

  // Insert published config
  db.run(
    `INSERT INTO configs (version, config_content, content_hash, content_size,
                          author_id, status, key_id, signature, expires_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      1,
      canonicalJson(config),
      contentHash,
      contentSize,
      "user-1",
      "published",
      keyId,
      signedManifest.signature,
      unsignedManifest.expires_at,
      now,
    ]
  );

  // Insert a second published config (version 2)
  const config2: Config = {
    ...config,
    features: { dark_mode: true, beta_features: true },
  };

  const contentHash2 = await computeContentHash(config2);
  const contentSize2 = computeContentSize(config2);

  const unsignedManifest2: UnsignedManifest = {
    version: 2,
    content_hash: contentHash2,
    content_size: contentSize2,
    key_id: keyId,
    timestamp: now + 60,
    expires_at: now + 86400 * 30,
  };

  const signedManifest2 = await signManifest(unsignedManifest2, privateKey);

  db.run(
    `INSERT INTO configs (version, config_content, content_hash, content_size,
                          author_id, status, key_id, signature, expires_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      2,
      canonicalJson(config2),
      contentHash2,
      contentSize2,
      "user-1",
      "published",
      keyId,
      signedManifest2.signature,
      unsignedManifest2.expires_at,
      now + 60,
    ]
  );

  // Insert a draft config (version 3) — should NOT appear in public API
  db.run(
    `INSERT INTO configs (version, config_content, content_hash, content_size,
                          author_id, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [3, '{"features":{}}', "sha256:0000000000000000000000000000000000000000000000000000000000000000", 0, "user-1", "draft"]
  );

  return { rootPubBase64, config, config2 };
}

// --- Tests ---

describe("Public API", () => {
  let store: Store;
  let app: Hono;
  let testConfig: Config;
  let testConfig2: Config;

  beforeAll(async () => {
    store = new Store(":memory:");
    store.runMigrations();
    const seeded = await seedTestData(store);
    testConfig = seeded.config;
    testConfig2 = seeded.config2;
    app = createApp(store);
  });

  afterAll(() => {
    store.close();
  });

  // Helper to make requests
  function request(path: string, headers: Record<string, string> = {}) {
    const req = new Request(`http://localhost${path}`, { headers });
    return app.fetch(req);
  }

  describe("GET /v1/keys", () => {
    test("returns latest key list", async () => {
      const res = await request("/v1/keys");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.version).toBe(1);
      expect(body.list_sequence).toBe(1);
      expect(body.keys).toHaveLength(1);
      expect(body.keys[0].key_id).toBe("key-001");
      expect(body.root_signature).toBeDefined();
    });

    test("returns 404 when no key list exists", async () => {
      const emptyStore = new Store(":memory:");
      emptyStore.runMigrations();
      const emptyApp = createApp(emptyStore);

      const res = await emptyApp.fetch(new Request("http://localhost/v1/keys"));
      expect(res.status).toBe(404);

      const body = await res.json();
      expect(body.error).toBeDefined();

      emptyStore.close();
    });
  });

  describe("GET /v1/config/latest", () => {
    test("returns latest published config with manifest", async () => {
      const res = await request("/v1/config/latest");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.manifest).toBeDefined();
      expect(body.config).toBeDefined();
      expect(body.manifest.version).toBe(2); // version 2 is the latest published
      expect(body.config.features.beta_features).toBe(true);
    });

    test("includes ETag header", async () => {
      const res = await request("/v1/config/latest");
      expect(res.status).toBe(200);

      const etag = res.headers.get("ETag");
      expect(etag).toBe('"v2"');
    });

    test("returns 304 when If-None-Match matches", async () => {
      const res = await request("/v1/config/latest", {
        "If-None-Match": '"v2"',
      });
      expect(res.status).toBe(304);
    });

    test("returns 200 when If-None-Match does not match", async () => {
      const res = await request("/v1/config/latest", {
        "If-None-Match": '"v1"',
      });
      expect(res.status).toBe(200);
    });

    test("returns 404 when no config published", async () => {
      const emptyStore = new Store(":memory:");
      emptyStore.runMigrations();
      const emptyApp = createApp(emptyStore);

      const res = await emptyApp.fetch(
        new Request("http://localhost/v1/config/latest")
      );
      expect(res.status).toBe(404);

      emptyStore.close();
    });
  });

  describe("GET /v1/config/latest/manifest", () => {
    test("returns only manifest (no config body)", async () => {
      const res = await request("/v1/config/latest/manifest");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.manifest).toBeDefined();
      expect(body.manifest.version).toBe(2);
      expect(body.config).toBeUndefined();
    });

    test("includes ETag header", async () => {
      const res = await request("/v1/config/latest/manifest");
      const etag = res.headers.get("ETag");
      expect(etag).toBe('"v2"');
    });

    test("returns 304 when If-None-Match matches", async () => {
      const res = await request("/v1/config/latest/manifest", {
        "If-None-Match": '"v2"',
      });
      expect(res.status).toBe(304);
    });

    test("returns 404 when no config published", async () => {
      const emptyStore = new Store(":memory:");
      emptyStore.runMigrations();
      const emptyApp = createApp(emptyStore);

      const res = await emptyApp.fetch(
        new Request("http://localhost/v1/config/latest/manifest")
      );
      expect(res.status).toBe(404);

      emptyStore.close();
    });
  });

  describe("GET /v1/config/:version", () => {
    test("returns specific published version", async () => {
      const res = await request("/v1/config/1");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.manifest.version).toBe(1);
      expect(body.config.features.beta_features).toBe(false);
    });

    test("returns version 2", async () => {
      const res = await request("/v1/config/2");
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.manifest.version).toBe(2);
      expect(body.config.features.beta_features).toBe(true);
    });

    test("returns 404 for non-published version (draft)", async () => {
      const res = await request("/v1/config/3");
      expect(res.status).toBe(404);
    });

    test("returns 404 for non-existent version", async () => {
      const res = await request("/v1/config/999");
      expect(res.status).toBe(404);
    });

    test("returns 400 for invalid version number", async () => {
      const res = await request("/v1/config/abc");
      expect(res.status).toBe(400);
    });

    test("returns 400 for negative version", async () => {
      const res = await request("/v1/config/-1");
      expect(res.status).toBe(400);
    });

    test("includes ETag header", async () => {
      const res = await request("/v1/config/1");
      const etag = res.headers.get("ETag");
      expect(etag).toBe('"v1"');
    });
  });

  describe("Store", () => {
    test("getLatestPublishedConfig returns highest version", () => {
      const result = store.getLatestPublishedConfig();
      expect(result).not.toBeNull();
      expect(result!.manifest.version).toBe(2);
    });

    test("getConfigByVersion returns correct version", () => {
      const result = store.getConfigByVersion(1);
      expect(result).not.toBeNull();
      expect(result!.manifest.version).toBe(1);
    });

    test("getConfigByVersion returns null for draft", () => {
      const result = store.getConfigByVersion(3);
      expect(result).toBeNull();
    });

    test("getConfigByVersion returns null for non-existent", () => {
      const result = store.getConfigByVersion(999);
      expect(result).toBeNull();
    });

    test("getLatestKeyList returns key list", () => {
      const result = store.getLatestKeyList();
      expect(result).not.toBeNull();
      expect(result!.version).toBe(1);
      expect(result!.keys).toHaveLength(1);
      expect(result!.root_signature).toBeDefined();
    });

    test("getLatestKeyList returns null when empty", () => {
      const emptyStore = new Store(":memory:");
      emptyStore.runMigrations();
      const result = emptyStore.getLatestKeyList();
      expect(result).toBeNull();
      emptyStore.close();
    });

    test("manifest has correct fields", () => {
      const result = store.getLatestPublishedConfig()!;
      const m = result.manifest;
      expect(m.version).toBeGreaterThan(0);
      expect(m.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(m.content_size).toBeGreaterThan(0);
      expect(m.key_id).toBe("key-001");
      expect(m.timestamp).toBeGreaterThan(0);
      expect(m.expires_at).toBeGreaterThan(m.timestamp);
      expect(m.signature).toBeDefined();
    });
  });
});
