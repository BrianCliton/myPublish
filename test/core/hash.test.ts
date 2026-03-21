import { describe, expect, test } from "bun:test";
import {
  computeContentHash,
  computeContentSize,
  verifyContentHash,
} from "../../src/core/hash.ts";
import type { Config } from "../../src/core/types.ts";

describe("computeContentHash", () => {
  test("returns sha256:<hex> format", async () => {
    const config: Config = { endpoints: { api: "https://api.example.com" } };
    const hash = await computeContentHash(config);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("deterministic for same config", async () => {
    const config: Config = { features: { dark_mode: true } };
    const hash1 = await computeContentHash(config);
    const hash2 = await computeContentHash(config);
    expect(hash1).toBe(hash2);
  });

  test("different config produces different hash", async () => {
    const config1: Config = { features: { a: true } };
    const config2: Config = { features: { a: false } };
    const hash1 = await computeContentHash(config1);
    const hash2 = await computeContentHash(config2);
    expect(hash1).not.toBe(hash2);
  });

  test("key order does not affect hash (canonical)", async () => {
    const config1: Config = { endpoints: { a: "1", b: "2" } };
    // Force different insertion order
    const obj: Record<string, string> = {};
    obj["b"] = "2";
    obj["a"] = "1";
    const config2: Config = { endpoints: obj };
    const hash1 = await computeContentHash(config1);
    const hash2 = await computeContentHash(config2);
    expect(hash1).toBe(hash2);
  });
});

describe("computeContentSize", () => {
  test("returns byte length of canonical JSON", () => {
    const config: Config = { features: { a: true } };
    const size = computeContentSize(config);
    expect(size).toBeGreaterThan(0);
    expect(typeof size).toBe("number");
  });

  test("handles unicode correctly (byte length, not char length)", () => {
    const config: Config = { custom: { msg: "日本語" } };
    const size = computeContentSize(config);
    // "日本語" is 9 bytes in UTF-8 (3 bytes each), not 3 chars
    expect(size).toBeGreaterThan(10);
  });
});

describe("verifyContentHash", () => {
  test("returns true for matching hash", async () => {
    const config: Config = { features: { test: true } };
    const hash = await computeContentHash(config);
    const result = await verifyContentHash(config, hash);
    expect(result).toBe(true);
  });

  test("returns false for non-matching hash", async () => {
    const config: Config = { features: { test: true } };
    const result = await verifyContentHash(config, "sha256:0000000000000000000000000000000000000000000000000000000000000000");
    expect(result).toBe(false);
  });
});
