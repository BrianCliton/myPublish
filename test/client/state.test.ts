import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { loadState, saveState, createDefaultState, type ClientState } from "../../src/client/state.ts";
import type { Config, Manifest, KeyList } from "../../src/core/types.ts";

describe("state", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "publish-state-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("createDefaultState", () => {
    test("returns fresh default state", () => {
      const state = createDefaultState();
      expect(state.last_config_version).toBe(0);
      expect(state.last_list_sequence).toBe(0);
      expect(state.cached_manifest).toBeNull();
      expect(state.cached_config).toBeNull();
      expect(state.cached_key_list).toBeNull();
    });

    test("returns independent copies", () => {
      const a = createDefaultState();
      const b = createDefaultState();
      a.last_config_version = 5;
      expect(b.last_config_version).toBe(0);
    });
  });

  describe("loadState", () => {
    test("returns default state when file does not exist", async () => {
      const state = await loadState(join(tempDir, "nonexistent.json"));
      expect(state).toEqual(createDefaultState());
    });

    test("returns default state on invalid JSON", async () => {
      const path = join(tempDir, "bad.json");
      await Bun.write(path, "not valid json {{{");
      const state = await loadState(path);
      expect(state).toEqual(createDefaultState());
    });

    test("returns default state on non-object JSON", async () => {
      const path = join(tempDir, "array.json");
      await Bun.write(path, JSON.stringify([1, 2, 3]));
      const state = await loadState(path);
      expect(state).toEqual(createDefaultState());
    });

    test("loads valid state from file", async () => {
      const path = join(tempDir, "state.json");
      const config: Config = { features: { dark_mode: true } };
      const savedState: ClientState = {
        last_config_version: 3,
        last_list_sequence: 2,
        cached_manifest: null,
        cached_config: config,
        cached_key_list: null,
      };
      await Bun.write(path, JSON.stringify(savedState));

      const state = await loadState(path);
      expect(state.last_config_version).toBe(3);
      expect(state.last_list_sequence).toBe(2);
      expect(state.cached_config).toEqual(config);
    });

    test("handles partial state gracefully", async () => {
      const path = join(tempDir, "partial.json");
      await Bun.write(path, JSON.stringify({ last_config_version: 7 }));
      const state = await loadState(path);
      expect(state.last_config_version).toBe(7);
      expect(state.last_list_sequence).toBe(0);
      expect(state.cached_manifest).toBeNull();
    });

    test("handles corrupt numeric fields", async () => {
      const path = join(tempDir, "corrupt.json");
      await Bun.write(path, JSON.stringify({
        last_config_version: "not-a-number",
        last_list_sequence: NaN,
      }));
      const state = await loadState(path);
      expect(state.last_config_version).toBe(0);
      expect(state.last_list_sequence).toBe(0);
    });
  });

  describe("saveState", () => {
    test("saves and loads roundtrip", async () => {
      const path = join(tempDir, "roundtrip.json");
      const manifest: Manifest = {
        version: 5,
        content_hash: "sha256:" + "a".repeat(64),
        content_size: 42,
        key_id: "key-1",
        timestamp: 1000000,
        expires_at: 2000000,
        signature: "c2lnbmF0dXJl",
      };
      const config: Config = {
        endpoints: { api: "https://api.example.com" },
      };
      const state: ClientState = {
        last_config_version: 5,
        last_list_sequence: 3,
        cached_manifest: manifest,
        cached_config: config,
        cached_key_list: null,
      };

      await saveState(path, state);
      const loaded = await loadState(path);
      expect(loaded.last_config_version).toBe(5);
      expect(loaded.last_list_sequence).toBe(3);
      expect(loaded.cached_manifest).toEqual(manifest);
      expect(loaded.cached_config).toEqual(config);
    });

    test("overwrites existing state file", async () => {
      const path = join(tempDir, "overwrite.json");
      const state1: ClientState = {
        ...createDefaultState(),
        last_config_version: 1,
      };
      const state2: ClientState = {
        ...createDefaultState(),
        last_config_version: 2,
      };

      await saveState(path, state1);
      await saveState(path, state2);
      const loaded = await loadState(path);
      expect(loaded.last_config_version).toBe(2);
    });
  });
});
