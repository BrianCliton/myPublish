import { describe, test, expect, beforeAll, afterAll } from "bun:test";

process.env.KEY_ENCRYPTION_KEY = "test-encryption-key-for-e2e";
process.env.NODE_ENV = "test";

import { Store } from "../../src/server/db/store.ts";
import { createApp } from "../../src/server/index.ts";
import { PublishClient } from "../../src/client/index.ts";
import { canonicalJson } from "../../src/core/canonical.ts";
import { computeContentHash, computeContentSize } from "../../src/core/hash.ts";
import {
  generateKeyPair,
  publicKeyToBase64,
  signManifest,
  signKeyList,
} from "../../src/core/signing.ts";
import { validateManifestAndConfig } from "../../src/core/validation.ts";
import { verifyContentHash } from "../../src/core/hash.ts";
import type {
  Config,
  KeyList,
  Manifest,
  UnsignedKeyList,
  UnsignedManifest,
} from "../../src/core/types.ts";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

/**
 * Full end-to-end test covering the complete publish-subscribe lifecycle.
 *
 * Since the admin API (Phase 4) is not yet implemented, administrative
 * operations (user creation, key management, config publishing) are
 * performed directly via the Store's DB handle.
 */
describe("E2E: Full Publish-Subscribe Flow", () => {
  let store: Store;
  let bunServer: ReturnType<typeof Bun.serve>;
  let serverUrl: string;
  let tmpDir: string;

  // Root key pair (offline, signs key lists only)
  let rootPublicKey: Uint8Array;
  let rootPrivateKey: Uint8Array;

  // Signing key pair #1 (online, signs configs)
  let signingPrivateKey: Uint8Array;
  let signingPubBase64: string;
  const signingKeyId = "signing-key-001";

  // Signing key pair #2 (for rotation)
  let signing2PrivateKey: Uint8Array;
  let signing2PubBase64: string;
  const signing2KeyId = "signing-key-002";

  const now = Math.floor(Date.now() / 1000);

  // --- DB seeding helpers (simulate admin API) ---

  function seedUser(id: string, username: string, role: string): void {
    store.testDb.run(
      `INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)`,
      [id, username, "hashed", role],
    );
  }

  function seedSigningKey(
    keyId: string,
    pubKeyBase64: string,
    status: "active" | "revoked" = "active",
    revokedAt?: number,
  ): void {
    store.testDb.run(
      `INSERT INTO signing_keys (key_id, public_key, private_key_enc, status, not_before, not_after, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [keyId, pubKeyBase64, "encrypted", status, now - 3600, now + 86400 * 365, revokedAt ?? null],
    );
  }

  async function publishKeyList(unsignedKeyList: UnsignedKeyList): Promise<KeyList> {
    const signed = await signKeyList(unsignedKeyList, rootPrivateKey);
    const { root_signature, ...content } = signed;
    store.testDb.run(
      `INSERT INTO key_lists (list_sequence, content, root_signature) VALUES (?, ?, ?)`,
      [signed.list_sequence, JSON.stringify(content), root_signature],
    );
    return signed;
  }

  async function publishConfig(
    config: Config,
    version: number,
    keyId: string,
    privateKey: Uint8Array,
    authorId: string = "user-publisher",
  ): Promise<{ manifest: Manifest; config: Config }> {
    const contentHash = await computeContentHash(config);
    const contentSize = computeContentSize(config);
    const unsigned: UnsignedManifest = {
      version,
      content_hash: contentHash,
      content_size: contentSize,
      key_id: keyId,
      timestamp: now + version, // ensure distinct timestamps
      expires_at: now + 86400 * 30,
    };
    const manifest = await signManifest(unsigned, privateKey);

    store.testDb.run(
      `INSERT INTO configs (version, config_content, content_hash, content_size,
                            author_id, status, key_id, signature, expires_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        version,
        canonicalJson(config),
        contentHash,
        contentSize,
        authorId,
        "published",
        keyId,
        manifest.signature,
        unsigned.expires_at,
        now + version,
      ],
    );

    return { manifest, config };
  }

  function updateKeyListInDb(keyList: KeyList): void {
    const { root_signature, ...content } = keyList;
    // Delete old and insert new
    store.testDb.run(`DELETE FROM key_lists WHERE list_sequence < ?`, [keyList.list_sequence]);
    store.testDb.run(
      `INSERT OR REPLACE INTO key_lists (list_sequence, content, root_signature) VALUES (?, ?, ?)`,
      [keyList.list_sequence, JSON.stringify(content), root_signature],
    );
  }

  // --- Setup & Teardown ---

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "publish-e2e-"));
    const dbPath = join(tmpDir, "test.db");

    // Step 1: Generate root key pair
    const rootPair = await generateKeyPair();
    rootPublicKey = rootPair.publicKey;
    rootPrivateKey = rootPair.privateKey;

    // Generate signing key pairs
    const signingPair = await generateKeyPair();
    signingPrivateKey = signingPair.privateKey;
    signingPubBase64 = publicKeyToBase64(signingPair.publicKey);

    const signing2Pair = await generateKeyPair();
    signing2PrivateKey = signing2Pair.privateKey;
    signing2PubBase64 = publicKeyToBase64(signing2Pair.publicKey);

    // Step 2: Start the server
    store = new Store(dbPath);
    store.runMigrations();
    const app = createApp(store);
    bunServer = Bun.serve({ fetch: app.fetch, port: 0 });
    serverUrl = `http://localhost:${bunServer.port}`;
  });

  afterAll(async () => {
    bunServer?.stop();
    store?.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // --- Tests ---

  test("Step 1-2: server starts and responds", async () => {
    // Server should return 404 when nothing is published yet
    const keysRes = await fetch(`${serverUrl}/v1/keys`);
    expect(keysRes.status).toBe(404);

    const configRes = await fetch(`${serverUrl}/v1/config/latest`);
    expect(configRes.status).toBe(404);
  });

  test("Step 3-4: seed users (admin, publisher, reviewer)", () => {
    seedUser("user-admin", "admin", "admin");
    seedUser("user-publisher", "publisher", "publisher");
    seedUser("user-reviewer1", "reviewer1", "reviewer");
    seedUser("user-reviewer2", "reviewer2", "reviewer");

    // Verify users exist
    const count = store.db
      .query<{ cnt: number }, []>("SELECT COUNT(*) as cnt FROM users")
      .get();
    expect(count!.cnt).toBe(4);
  });

  test("Step 5: generate and store signing keys", () => {
    seedSigningKey(signingKeyId, signingPubBase64);
    seedSigningKey(signing2KeyId, signing2PubBase64);

    const keys = store.db
      .query<{ key_id: string }, []>("SELECT key_id FROM signing_keys WHERE status = 'active'")
      .all();
    expect(keys).toHaveLength(2);
  });

  test("Step 6: publish key list (signed by root key)", async () => {
    const unsignedKeyList: UnsignedKeyList = {
      version: 1,
      list_sequence: 1,
      timestamp: now,
      expires_at: now + 86400 * 30,
      keys: [
        {
          key_id: signingKeyId,
          public_key: signingPubBase64,
          status: "active" as const,
          not_before: now - 3600,
          not_after: now + 86400 * 365,
        },
        {
          key_id: signing2KeyId,
          public_key: signing2PubBase64,
          status: "active" as const,
          not_before: now - 3600,
          not_after: now + 86400 * 365,
        },
      ],
    };

    await publishKeyList(unsignedKeyList);

    // Verify via public API
    const res = await fetch(`${serverUrl}/v1/keys`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.keys).toHaveLength(2);
    expect(body.root_signature).toBeDefined();
  });

  test("Step 7-8: create config draft, submit for review, approve, publish", async () => {
    const config: Config = {
      update: {
        latest_version: "2.0.0",
        min_version: "1.0.0",
        download_url: "https://example.com/download/v2",
        sha256: "abc123def456",
        release_notes: "Initial release",
      },
      endpoints: {
        api: "https://api.example.com",
        cdn: "https://cdn.example.com",
      },
      features: {
        dark_mode: true,
        beta_features: false,
        push_notifications: true,
      },
      announcements: [
        {
          id: "ann-001",
          type: "banner",
          content: "Welcome to v2!",
          priority: 1,
          expires_at: now + 86400 * 7,
        },
      ],
    };

    // Simulate: draft -> pending_review -> approved (2 reviewers) -> published
    // We directly insert as published since admin API isn't built yet
    const { manifest } = await publishConfig(config, 1, signingKeyId, signingPrivateKey);

    // Also record approvals for audit trail
    store.testDb.run(
      `INSERT INTO approvals (id, config_ver, reviewer_id, decision) VALUES (?, ?, ?, ?)`,
      ["approval-1", 1, "user-reviewer1", "approved"],
    );
    store.testDb.run(
      `INSERT INTO approvals (id, config_ver, reviewer_id, decision) VALUES (?, ?, ?, ?)`,
      ["approval-2", 1, "user-reviewer2", "approved"],
    );

    // Verify via public API
    const res = await fetch(`${serverUrl}/v1/config/latest`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manifest.version).toBe(1);
    expect(body.config.features.dark_mode).toBe(true);
    expect(body.manifest.signature).toBe(manifest.signature);
  });

  test("Step 9-11: client fetches, verifies manifest signature, verifies content hash, applies", async () => {
    let receivedConfig: Config | null = null;
    let receivedManifest: Manifest | null = null;

    const client = new PublishClient({
      serverUrl,
      rootPublicKey,
      onConfigUpdate: (config, manifest) => {
        receivedConfig = config;
        receivedManifest = manifest;
      },
    });

    const result = await client.check();

    expect(result.updated).toBe(true);
    expect(result.config).toBeDefined();
    expect(result.manifest).toBeDefined();
    expect(result.manifest!.version).toBe(1);

    // Verify manifest signature independently
    const keyListRes = await fetch(`${serverUrl}/v1/keys`);
    const keyList = await keyListRes.json();
    const validation = await validateManifestAndConfig(
      result.manifest!,
      result.config!,
      keyList,
      rootPublicKey,
    );
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    // Verify content hash independently
    const hashValid = await verifyContentHash(result.config!, result.manifest!.content_hash);
    expect(hashValid).toBe(true);

    // Verify callback was called
    expect(receivedConfig).toEqual(result.config);
    expect(receivedManifest).toEqual(result.manifest);

    // Client state should be cached
    expect(client.getCurrentConfig()).toEqual(result.config);
    expect(client.getCurrentManifest()).toEqual(result.manifest);

    client.stop();
  });

  test("Step 12-13: update config, go through approval flow again", async () => {
    const configV2: Config = {
      update: {
        latest_version: "2.1.0",
        min_version: "1.5.0",
        download_url: "https://example.com/download/v2.1",
        sha256: "new_sha256_hash",
        release_notes: "Bug fixes and improvements",
        force: true,
      },
      endpoints: {
        api: "https://api-v2.example.com",
        cdn: "https://cdn.example.com",
      },
      features: {
        dark_mode: true,
        beta_features: true, // changed
        push_notifications: true,
        offline_mode: true, // new feature
      },
    };

    // Publish v2 (based on v1, with one field changed)
    await publishConfig(configV2, 2, signingKeyId, signingPrivateKey);

    // Record approvals
    store.testDb.run(
      `INSERT INTO approvals (id, config_ver, reviewer_id, decision) VALUES (?, ?, ?, ?)`,
      ["approval-3", 2, "user-reviewer1", "approved"],
    );
    store.testDb.run(
      `INSERT INTO approvals (id, config_ver, reviewer_id, decision) VALUES (?, ?, ?, ?)`,
      ["approval-4", 2, "user-reviewer2", "approved"],
    );

    // Verify v2 is now latest
    const res = await fetch(`${serverUrl}/v1/config/latest`);
    const body = await res.json();
    expect(body.manifest.version).toBe(2);
    expect(body.config.features.beta_features).toBe(true);
    expect(body.config.features.offline_mode).toBe(true);

    // Verify v1 is still accessible
    const v1Res = await fetch(`${serverUrl}/v1/config/1`);
    const v1Body = await v1Res.json();
    expect(v1Body.manifest.version).toBe(1);
    expect(v1Body.config.features.beta_features).toBe(false);
  });

  test("Step 14: client detects version change via manifest endpoint, fetches full config", async () => {
    // First, check manifest-only endpoint for lightweight version detection
    const manifestRes = await fetch(`${serverUrl}/v1/config/latest/manifest`);
    expect(manifestRes.status).toBe(200);
    const manifestBody = await manifestRes.json();
    expect(manifestBody.manifest.version).toBe(2);

    // ETag should reflect v2
    const etag = manifestRes.headers.get("ETag");
    expect(etag).toBe('"v2"');

    // Client should detect the update
    const client = new PublishClient({
      serverUrl,
      rootPublicKey,
    });

    const result = await client.check();
    expect(result.updated).toBe(true);
    expect(result.manifest!.version).toBe(2);
    expect(result.config!.features!.beta_features).toBe(true);

    // Full validation
    const keyListRes = await fetch(`${serverUrl}/v1/keys`);
    const keyList = await keyListRes.json();
    const validation = await validateManifestAndConfig(
      result.manifest!,
      result.config!,
      keyList,
      rootPublicKey,
    );
    expect(validation.valid).toBe(true);

    // Second check should show no update (same version)
    const result2 = await client.check();
    expect(result2.updated).toBe(false);

    client.stop();
  });

  test("Step 15: revoke signing key, publish new key list", async () => {
    // Revoke signing-key-001 in the DB
    store.testDb.run(
      `UPDATE signing_keys SET status = 'revoked', revoked_at = ? WHERE key_id = ?`,
      [now, signingKeyId],
    );

    // Publish new key list (sequence 2) with key-001 revoked
    const unsignedKeyList: UnsignedKeyList = {
      version: 1,
      list_sequence: 2,
      timestamp: now + 100,
      expires_at: now + 86400 * 30,
      keys: [
        {
          key_id: signingKeyId,
          public_key: signingPubBase64,
          status: "revoked" as const,
          not_before: now - 3600,
          not_after: now + 86400 * 365,
          revoked_at: now,
        },
        {
          key_id: signing2KeyId,
          public_key: signing2PubBase64,
          status: "active" as const,
          not_before: now - 3600,
          not_after: now + 86400 * 365,
        },
      ],
    };

    const newKeyList = await signKeyList(unsignedKeyList, rootPrivateKey);
    updateKeyListInDb(newKeyList);

    // Verify new key list via API
    const keysRes = await fetch(`${serverUrl}/v1/keys`);
    const keysBody = await keysRes.json();
    expect(keysBody.list_sequence).toBe(2);
    const revokedKey = keysBody.keys.find((k: any) => k.key_id === signingKeyId);
    expect(revokedKey.status).toBe("revoked");
  });

  test("Step 16: client rejects messages signed by revoked key", async () => {
    const errors: Error[] = [];

    // Fresh client that will fetch the new key list (with revoked key-001)
    const client = new PublishClient({
      serverUrl,
      rootPublicKey,
      onError: (err) => errors.push(err),
    });

    // The current published configs (v1 and v2) were signed with key-001 (now revoked).
    // The client should detect the revocation and reject validation.
    const result = await client.check();

    // The validation should fail because key-001 is revoked
    expect(result.updated).toBe(false);
    // Errors should mention validation failure
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.message.includes("Validation failed"))).toBe(true);
  });

  test("Step 16b: publish config with new signing key, client accepts it", async () => {
    // Publish v3 signed with key-002 (still active)
    const configV3: Config = {
      update: {
        latest_version: "3.0.0",
        min_version: "2.0.0",
        download_url: "https://example.com/download/v3",
        sha256: "v3_sha256",
      },
      endpoints: {
        api: "https://api-v3.example.com",
      },
      features: {
        dark_mode: true,
        beta_features: true,
        offline_mode: true,
        ai_assistant: true, // new feature
      },
    };

    await publishConfig(configV3, 3, signing2KeyId, signing2PrivateKey);

    // Fresh client should accept v3 (signed with active key-002)
    const client = new PublishClient({
      serverUrl,
      rootPublicKey,
    });

    const result = await client.check();
    expect(result.updated).toBe(true);
    expect(result.manifest!.version).toBe(3);
    expect(result.config!.features!.ai_assistant).toBe(true);

    // Full validation passes
    const keyListRes = await fetch(`${serverUrl}/v1/keys`);
    const keyList = await keyListRes.json();
    const validation = await validateManifestAndConfig(
      result.manifest!,
      result.config!,
      keyList,
      rootPublicKey,
    );
    expect(validation.valid).toBe(true);

    client.stop();
  });

  test("ETag caching works across config versions", async () => {
    // Request with current ETag should get 304
    const res304 = await fetch(`${serverUrl}/v1/config/latest`, {
      headers: { "If-None-Match": '"v3"' },
    });
    expect(res304.status).toBe(304);

    // Stale ETag should get full response
    const res200 = await fetch(`${serverUrl}/v1/config/latest`, {
      headers: { "If-None-Match": '"v1"' },
    });
    expect(res200.status).toBe(200);
    const body = await res200.json();
    expect(body.manifest.version).toBe(3);
  });

  test("client persists and restores state", async () => {
    const statePath = join(tmpDir, "client-state.json");

    // First client: fetch and persist
    const client1 = new PublishClient({
      serverUrl,
      rootPublicKey,
      statePath,
    });

    const result1 = await client1.check();
    expect(result1.updated).toBe(true);
    expect(result1.manifest!.version).toBe(3);
    client1.stop();

    // Second client: should restore state and see no update
    const client2 = new PublishClient({
      serverUrl,
      rootPublicKey,
      statePath,
    });

    const result2 = await client2.check();
    expect(result2.updated).toBe(false); // already at v3
    expect(client2.getCurrentConfig()!.features!.ai_assistant).toBe(true);
    client2.stop();
  });

  test("content hash integrity across full pipeline", async () => {
    // Fetch config from server
    const res = await fetch(`${serverUrl}/v1/config/latest`);
    const body = await res.json();

    // Recompute hash from config content
    const recomputedHash = await computeContentHash(body.config);
    expect(body.manifest.content_hash).toBe(recomputedHash);

    // Recompute size
    const recomputedSize = computeContentSize(body.config);
    expect(body.manifest.content_size).toBe(recomputedSize);
  });

  test("all published versions are independently verifiable", async () => {
    // Fetch current key list
    const keysRes = await fetch(`${serverUrl}/v1/keys`);
    const keyList = await keysRes.json();

    // Version 3 (signed with active key-002) should validate
    const v3Res = await fetch(`${serverUrl}/v1/config/3`);
    const v3 = await v3Res.json();
    const v3Validation = await validateManifestAndConfig(
      v3.manifest,
      v3.config,
      keyList,
      rootPublicKey,
    );
    expect(v3Validation.valid).toBe(true);

    // Version 1 (signed with revoked key-001) should NOT validate
    const v1Res = await fetch(`${serverUrl}/v1/config/1`);
    const v1 = await v1Res.json();
    const v1Validation = await validateManifestAndConfig(
      v1.manifest,
      v1.config,
      keyList,
      rootPublicKey,
    );
    expect(v1Validation.valid).toBe(false);
    expect(v1Validation.errors.some((e) => e.includes("not authorized"))).toBe(true);
  });
});
