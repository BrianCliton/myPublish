import { describe, expect, test, beforeAll, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { PublishClient } from "../../src/client/index.ts";
import {
  generateKeyPair,
  signKeyList,
  signManifest,
  publicKeyToBase64,
} from "../../src/core/signing.ts";
import { computeContentHash, computeContentSize } from "../../src/core/hash.ts";
import type { Config, KeyList, UnsignedKeyList, UnsignedManifest } from "../../src/core/types.ts";

describe("PublishClient", () => {
  let rootPublicKey: Uint8Array;
  let rootPrivateKey: Uint8Array;
  let signingPrivateKey: Uint8Array;
  let signingKeyBase64: string;
  let keyList: KeyList;
  const now = Math.floor(Date.now() / 1000);
  let tempDir: string;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    const rootPair = await generateKeyPair();
    rootPublicKey = rootPair.publicKey;
    rootPrivateKey = rootPair.privateKey;
    const signingPair = await generateKeyPair();
    signingPrivateKey = signingPair.privateKey;
    signingKeyBase64 = publicKeyToBase64(signingPair.publicKey);

    const unsignedKeyList: UnsignedKeyList = {
      version: 1,
      list_sequence: 1,
      timestamp: now,
      expires_at: now + 86400,
      keys: [
        {
          key_id: "key-1",
          public_key: signingKeyBase64,
          status: "active",
          not_before: now - 3600,
          not_after: now + 86400,
        },
      ],
    };
    keyList = await signKeyList(unsignedKeyList, rootPrivateKey);
  });

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "publish-client-"));
    originalFetch = globalThis.fetch;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createSignedConfig(config: Config, version: number) {
    const contentHash = await computeContentHash(config);
    const contentSize = computeContentSize(config);
    const unsigned: UnsignedManifest = {
      version,
      content_hash: contentHash,
      content_size: contentSize,
      key_id: "key-1",
      timestamp: now,
      expires_at: now + 86400,
    };
    const manifest = await signManifest(unsigned, signingPrivateKey);
    return { manifest, config };
  }

  function mockFetch(responses: Record<string, () => Response | Promise<Response>>): void {
    globalThis.fetch = (async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      for (const [pattern, handler] of Object.entries(responses)) {
        if (url.includes(pattern)) {
          return handler();
        }
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof fetch;
  }

  test("initially has null config and manifest", () => {
    const client = new PublishClient({
      serverUrl: "http://localhost:9999",
      rootPublicKey,
    });
    expect(client.getCurrentConfig()).toBeNull();
    expect(client.getCurrentManifest()).toBeNull();
  });

  test("check() fetches and verifies config", async () => {
    const { manifest, config } = await createSignedConfig(
      { features: { dark_mode: true } },
      1,
    );

    mockFetch({
      "/v1/keys": () => Response.json(keyList),
      "/v1/config/latest/manifest": () => Response.json(manifest),
      "/v1/config/latest": () => Response.json({ manifest, config }),
    });

    const client = new PublishClient({
      serverUrl: "http://localhost:9999",
      rootPublicKey,
    });

    const result = await client.check();
    expect(result.updated).toBe(true);
    expect(result.config).toEqual(config);
    expect(client.getCurrentConfig()).toEqual(config);
    expect(client.getCurrentManifest()).toEqual(manifest);
  });

  test("check() returns updated:false when no new version", async () => {
    const { manifest, config } = await createSignedConfig(
      { features: { test: true } },
      1,
    );

    mockFetch({
      "/v1/keys": () => Response.json(keyList),
      "/v1/config/latest/manifest": () => Response.json(manifest),
      "/v1/config/latest": () => Response.json({ manifest, config }),
    });

    const client = new PublishClient({
      serverUrl: "http://localhost:9999",
      rootPublicKey,
    });

    // First check picks up v1
    await client.check();
    // Second check should see no update
    const result = await client.check();
    expect(result.updated).toBe(false);
  });

  test("check() does not throw on server error", async () => {
    mockFetch({
      "/v1/keys": () => new Response("Error", { status: 500 }),
      "/v1/config/latest/manifest": () =>
        new Response("Error", { status: 500 }),
    });

    const errors: Error[] = [];
    const client = new PublishClient({
      serverUrl: "http://localhost:9999",
      rootPublicKey,
      onError: (e) => errors.push(e),
    });

    const result = await client.check();
    expect(result.updated).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("persists and restores state", async () => {
    const statePath = join(tempDir, "state.json");
    const { manifest, config } = await createSignedConfig(
      { endpoints: { api: "https://api.example.com" } },
      3,
    );

    mockFetch({
      "/v1/keys": () => Response.json(keyList),
      "/v1/config/latest/manifest": () => Response.json(manifest),
      "/v1/config/latest": () => Response.json({ manifest, config }),
    });

    // First client fetches config
    const client1 = new PublishClient({
      serverUrl: "http://localhost:9999",
      rootPublicKey,
      statePath,
    });
    await client1.check();
    expect(client1.getCurrentConfig()).toEqual(config);
    client1.stop();

    // Second client restores from persisted state
    const client2 = new PublishClient({
      serverUrl: "http://localhost:9999",
      rootPublicKey,
      statePath,
    });
    // Trigger state load
    const result = await client2.check();
    expect(result.updated).toBe(false); // version 3 already cached
    expect(client2.getCurrentConfig()).toEqual(config);
  });

  test("calls onConfigUpdate callback", async () => {
    const { manifest, config } = await createSignedConfig(
      { features: { callback_test: true } },
      1,
    );
    let callbackConfig: Config | null = null;

    mockFetch({
      "/v1/keys": () => Response.json(keyList),
      "/v1/config/latest/manifest": () => Response.json(manifest),
      "/v1/config/latest": () => Response.json({ manifest, config }),
    });

    const client = new PublishClient({
      serverUrl: "http://localhost:9999",
      rootPublicKey,
      onConfigUpdate: (c) => {
        callbackConfig = c;
      },
    });

    await client.check();
    expect(callbackConfig).toEqual(config);
  });

  test("start and stop lifecycle", async () => {
    const { manifest, config } = await createSignedConfig(
      { features: { test: true } },
      1,
    );

    mockFetch({
      "/v1/keys": () => Response.json(keyList),
      "/v1/config/latest/manifest": () => Response.json(manifest),
      "/v1/config/latest": () => Response.json({ manifest, config }),
    });

    const client = new PublishClient({
      serverUrl: "http://localhost:9999",
      rootPublicKey,
      pollInterval: 0.01,
    });

    await client.start();
    // Wait for first poll
    await new Promise((r) => setTimeout(r, 100));
    client.stop();

    expect(client.getCurrentConfig()).toEqual(config);
  });

  test("handles corrupt state file gracefully", async () => {
    const statePath = join(tempDir, "corrupt.json");
    await Bun.write(statePath, "{{corrupt}}");

    const { manifest, config } = await createSignedConfig(
      { features: { recovery: true } },
      1,
    );

    mockFetch({
      "/v1/keys": () => Response.json(keyList),
      "/v1/config/latest/manifest": () => Response.json(manifest),
      "/v1/config/latest": () => Response.json({ manifest, config }),
    });

    const client = new PublishClient({
      serverUrl: "http://localhost:9999",
      rootPublicKey,
      statePath,
    });

    // Should not throw on corrupt state
    const result = await client.check();
    expect(result.updated).toBe(true);
  });
});
