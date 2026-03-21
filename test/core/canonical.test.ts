import { describe, expect, test } from "bun:test";
import { canonicalJson } from "../../src/core/canonical.ts";

describe("canonicalJson", () => {
  test("sorts object keys by Unicode code point", () => {
    const input = { z: 1, a: 2, m: 3 };
    expect(canonicalJson(input)).toBe('{"a":2,"m":3,"z":1}');
  });

  test("sorts nested object keys", () => {
    const input = { b: { z: 1, a: 2 }, a: 1 };
    expect(canonicalJson(input)).toBe('{"a":1,"b":{"a":2,"z":1}}');
  });

  test("handles arrays without reordering", () => {
    const input = [3, 1, 2];
    expect(canonicalJson(input)).toBe("[3,1,2]");
  });

  test("handles arrays of objects with sorted keys", () => {
    const input = [{ b: 1, a: 2 }];
    expect(canonicalJson(input)).toBe('[{"a":2,"b":1}]');
  });

  test("handles strings with escaping", () => {
    expect(canonicalJson('hello "world"')).toBe('"hello \\"world\\""');
    expect(canonicalJson("line\nnew")).toBe('"line\\nnew"');
  });

  test("handles unicode strings", () => {
    const input = { "日本語": "テスト", abc: 1 };
    expect(canonicalJson(input)).toBe('{"abc":1,"日本語":"テスト"}');
  });

  test("handles null", () => {
    expect(canonicalJson(null)).toBe("null");
  });

  test("handles booleans", () => {
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(false)).toBe("false");
  });

  test("handles numbers", () => {
    expect(canonicalJson(0)).toBe("0");
    expect(canonicalJson(-1)).toBe("-1");
    expect(canonicalJson(3.14)).toBe("3.14");
    expect(canonicalJson(1e2)).toBe("100");
  });

  test("handles empty objects and arrays", () => {
    expect(canonicalJson({})).toBe("{}");
    expect(canonicalJson([])).toBe("[]");
  });

  test("no whitespace in output", () => {
    const input = { a: [1, { b: 2 }] };
    const result = canonicalJson(input);
    expect(result).not.toContain(" ");
    expect(result).not.toContain("\n");
    expect(result).not.toContain("\t");
  });

  test("throws for undefined", () => {
    expect(() => canonicalJson(undefined)).toThrow("Cannot serialize undefined");
  });

  test("throws for non-finite numbers", () => {
    expect(() => canonicalJson(Infinity)).toThrow("non-finite");
    expect(() => canonicalJson(NaN)).toThrow("non-finite");
    expect(() => canonicalJson(-Infinity)).toThrow("non-finite");
  });

  test("deterministic output for same input", () => {
    const input = { version: 1, key_id: "k1", timestamp: 1000 };
    const a = canonicalJson(input);
    const b = canonicalJson(input);
    expect(a).toBe(b);
  });

  test("handles deeply nested structures", () => {
    const input = { a: { b: { c: { d: 1 } } } };
    expect(canonicalJson(input)).toBe('{"a":{"b":{"c":{"d":1}}}}');
  });

  test("handles null values in objects", () => {
    const input = { a: null, b: 1 };
    expect(canonicalJson(input)).toBe('{"a":null,"b":1}');
  });
});
