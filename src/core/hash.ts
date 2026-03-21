import { canonicalJson } from "./canonical.ts";
import type { Config } from "./types.ts";

const encoder = new TextEncoder();

/**
 * Compute SHA-256 hash of canonical JSON representation of config.
 * Returns "sha256:<hex_lowercase>".
 */
export async function computeContentHash(config: Config): Promise<string> {
  const canonical = canonicalJson(config);
  const bytes = encoder.encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  const hex = bufferToHex(new Uint8Array(hashBuffer));
  return `sha256:${hex}`;
}

/**
 * Compute byte length of canonical JSON representation of config.
 */
export function computeContentSize(config: Config): number {
  const canonical = canonicalJson(config);
  return encoder.encode(canonical).byteLength;
}

/**
 * Verify that a config's canonical JSON hash matches the expected hash.
 */
export async function verifyContentHash(
  config: Config,
  expectedHash: string,
): Promise<boolean> {
  const actual = await computeContentHash(config);
  return actual === expectedHash;
}

function bufferToHex(buffer: Uint8Array): string {
  const parts: string[] = [];
  for (const byte of buffer) {
    parts.push(byte.toString(16).padStart(2, "0"));
  }
  return parts.join("");
}
