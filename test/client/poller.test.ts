import { describe, expect, test, beforeAll, beforeEach, afterEach, mock } from "bun:test";
import { Poller, type PollerOptions } from "../../src/client/poller.ts";
import { KeyRing } from "../../src/client/keyring.ts";
import { createDefaultState, type ClientState } from "../../src/client/state.ts";
import {
  generateKeyPair,
  signKeyList,
  signManifest,
  publicKeyToBase64,
} from "../../src/core/signing.ts";
import { computeContentHash, computeContentSize } from "../../src/core/hash.ts";
import type { Config, KeyList, Manifest, UnsignedKeyList, UnsignedManifest } from "../../src/core/types.ts";

describe("Poller", () => {
  let rootPublicKey: Uint8Array;
  let rootPrivateKey: Uint8Array;
  let signingPublicKey: Uint8Array;
  let signingPrivateKey: Uint8Array;
  let signingKeyBase64: string;
  const now = Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    const rootPair = await generateKeyPair();
    rootPublicKey = rootPair.publicKey;
    rootPrivateKey = rootPair.privateKey;
    const signingPair = await generateKeyPair();
    signingPublicKey = signingPair.publicKey;
    signingPrivateKey = signingPair.privateKey;
    signingKeyBase64 = publicKeyToBase64(signingPublicKey);
  });

  let state: ClientState;
  let keyRing: KeyRing;
  let keyList: KeyList;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    state = createDefaultState();
    keyRing = new KeyRing(rootPublicKey);
    originalFetch = globalThis.fetch;

    // Create and install a key list
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
    await keyRing.updateFromKeyList(keyList);
    state.last_list_sequence = 1;
    state.cached_key_list = keyList;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  async function createSignedConfig(
    config: Config,
    version: number,
  ): Promise<{ manifest: Manifest; config: Config }> {
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

  function createPollerOptions(overrides: Partial<PollerOptions> = {}): PollerOptions {
    return {
      serverUrl: "http://localhost:9999",
      keyRing,
      pollInterval: 3600,
      rootPublicKey,
      getState: () => state,
      setState: (updater) => {
        state = updater(state);
      },
      ...overrides,
    };
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

  describe("check()", () => {
    test("detects and applies new config", async () => {
      const { manifest, config } = await createSignedConfig(
        { features: { dark_mode: true } },
        1,
      );

      mockFetch({
        "/v1/keys": () => Response.json(keyList),
        "/v1/config/latest/manifest": () => Response.json(manifest),
        "/v1/config/latest": () => Response.json({ manifest, config }),
      });

      const poller = new Poller(createPollerOptions());
      const result = await poller.check();
      expect(result.updated).toBe(true);
      expect(result.config).toEqual(config);
      expect(result.manifest).toEqual(manifest);
      expect(state.last_config_version).toBe(1);
      expect(state.cached_config).toEqual(config);
    });

    test("skips update when version has not changed", async () => {
      state.last_config_version = 5;
      const { manifest } = await createSignedConfig(
        { features: {} },
        5, // same version
      );

      mockFetch({
        "/v1/keys": () => Response.json(keyList),
        "/v1/config/latest/manifest": () => Response.json(manifest),
      });

      const poller = new Poller(createPollerOptions());
      const result = await poller.check();
      expect(result.updated).toBe(false);
    });

    test("calls onConfigUpdate callback on update", async () => {
      const { manifest, config } = await createSignedConfig(
        { endpoints: { api: "https://api.test" } },
        1,
      );
      let callbackCalled = false;
      let callbackConfig: Config | null = null;

      mockFetch({
        "/v1/keys": () => Response.json(keyList),
        "/v1/config/latest/manifest": () => Response.json(manifest),
        "/v1/config/latest": () => Response.json({ manifest, config }),
      });

      const poller = new Poller(
        createPollerOptions({
          onConfigUpdate: (c, _m) => {
            callbackCalled = true;
            callbackConfig = c;
          },
        }),
      );
      await poller.check();
      expect(callbackCalled).toBe(true);
      expect(callbackConfig).toEqual(config);
    });

    test("reports error on manifest fetch failure", async () => {
      mockFetch({
        "/v1/keys": () => Response.json(keyList),
        "/v1/config/latest/manifest": () =>
          new Response("Internal Server Error", { status: 500 }),
      });

      const poller = new Poller(createPollerOptions());
      await expect(poller.check()).rejects.toThrow("Manifest endpoint returned 500");
    });

    test("continues with cached keys if key list fetch fails", async () => {
      const { manifest, config } = await createSignedConfig(
        { features: { test: true } },
        1,
      );
      const errors: Error[] = [];

      mockFetch({
        "/v1/keys": () => new Response("Error", { status: 500 }),
        "/v1/config/latest/manifest": () => Response.json(manifest),
        "/v1/config/latest": () => Response.json({ manifest, config }),
      });

      const poller = new Poller(
        createPollerOptions({
          onError: (e) => errors.push(e),
        }),
      );
      const result = await poller.check();
      expect(result.updated).toBe(true);
      expect(errors.some((e) => e.message.includes("Key list fetch failed"))).toBe(true);
    });

    test("rejects config with invalid signature", async () => {
      const config: Config = { features: { test: true } };
      const contentHash = await computeContentHash(config);
      const contentSize = computeContentSize(config);
      // Sign with wrong key
      const otherPair = await generateKeyPair();
      const unsigned: UnsignedManifest = {
        version: 1,
        content_hash: contentHash,
        content_size: contentSize,
        key_id: "key-1",
        timestamp: now,
        expires_at: now + 86400,
      };
      const badManifest = await signManifest(unsigned, otherPair.privateKey);

      mockFetch({
        "/v1/keys": () => Response.json(keyList),
        "/v1/config/latest/manifest": () => Response.json(badManifest),
        "/v1/config/latest": () =>
          Response.json({ manifest: badManifest, config }),
      });

      const poller = new Poller(createPollerOptions());
      await expect(poller.check()).rejects.toThrow("Validation failed");
      expect(state.last_config_version).toBe(0); // not updated
    });

    test("rejects config with hash mismatch", async () => {
      const config: Config = { features: { test: true } };
      const tampered: Config = { features: { test: false } }; // different
      const contentHash = await computeContentHash(config);
      const contentSize = computeContentSize(config);
      const unsigned: UnsignedManifest = {
        version: 1,
        content_hash: contentHash,
        content_size: contentSize,
        key_id: "key-1",
        timestamp: now,
        expires_at: now + 86400,
      };
      const manifest = await signManifest(unsigned, signingPrivateKey);

      mockFetch({
        "/v1/keys": () => Response.json(keyList),
        "/v1/config/latest/manifest": () => Response.json(manifest),
        "/v1/config/latest": () =>
          Response.json({ manifest, config: tampered }),
      });

      const poller = new Poller(createPollerOptions());
      await expect(poller.check()).rejects.toThrow("Validation failed");
    });

    test("updates key list when new sequence available", async () => {
      const { manifest, config } = await createSignedConfig(
        { features: { v2: true } },
        1,
      );

      // New key list with higher sequence
      const newUnsigned: UnsignedKeyList = {
        version: 1,
        list_sequence: 5,
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
      const newKeyList = await signKeyList(newUnsigned, rootPrivateKey);

      mockFetch({
        "/v1/keys": () => Response.json(newKeyList),
        "/v1/config/latest/manifest": () => Response.json(manifest),
        "/v1/config/latest": () => Response.json({ manifest, config }),
      });

      const poller = new Poller(createPollerOptions());
      const result = await poller.check();
      expect(result.updated).toBe(true);
      expect(result.keyListUpdated).toBe(true);
      expect(state.last_list_sequence).toBe(5);
    });
  });

  describe("start/stop", () => {
    test("stop prevents further polling", async () => {
      const { manifest, config } = await createSignedConfig(
        { features: { test: true } },
        1,
      );
      let fetchCount = 0;

      mockFetch({
        "/v1/keys": () => {
          fetchCount++;
          return Response.json(keyList);
        },
        "/v1/config/latest/manifest": () => Response.json(manifest),
        "/v1/config/latest": () => Response.json({ manifest, config }),
      });

      const poller = new Poller(createPollerOptions({ pollInterval: 0.01 }));
      poller.start();
      // Wait a small amount for the first poll
      await new Promise((r) => setTimeout(r, 50));
      poller.stop();
      const countAtStop = fetchCount;
      // Wait more and confirm no further polls
      await new Promise((r) => setTimeout(r, 100));
      expect(fetchCount).toBe(countAtStop);
    });

    test("start is idempotent", () => {
      const poller = new Poller(createPollerOptions());
      poller.start();
      poller.start(); // should not throw or create duplicate timers
      poller.stop();
    });
  });
});
