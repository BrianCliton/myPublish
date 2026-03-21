import { computeContentHash, computeContentSize } from "./hash.ts";
import { findActiveKey, isKeyAuthorized } from "./keylist.ts";
import { base64ToPublicKey, verifyKeyList, verifyManifest } from "./signing.ts";
import type { Config, KeyList, Manifest } from "./types.ts";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Full validation pipeline for a manifest + config pair against a trusted key list.
 *
 * Checks:
 * 1. key_id exists in KeyList and is active
 * 2. Manifest signature is valid using the key's public key
 * 3. content_hash matches SHA-256 of canonical_json(config)
 * 4. content_size matches byte length of canonical_json(config)
 * 5. expires_at > now
 * 6. version > 0
 * 7. KeyList root signature is valid
 */
export async function validateManifestAndConfig(
  manifest: Manifest,
  config: Config,
  keyList: KeyList,
  rootPublicKey: Uint8Array,
  now?: number,
): Promise<ValidationResult> {
  const errors: string[] = [];
  const currentTime = now ?? Math.floor(Date.now() / 1000);

  // 7. Verify KeyList root signature
  const keyListValid = await verifyKeyList(keyList, rootPublicKey);
  if (!keyListValid) {
    errors.push("KeyList root signature is invalid");
    return { valid: false, errors };
  }

  // 6. Version > 0
  if (manifest.version < 1) {
    errors.push("Manifest version must be >= 1");
  }

  // 5. Check expiry
  if (manifest.expires_at <= currentTime) {
    errors.push("Manifest has expired");
  }

  // 1. key_id exists and is authorized
  if (!isKeyAuthorized(keyList, manifest.key_id, currentTime)) {
    errors.push(
      `Key ${manifest.key_id} is not authorized (missing, revoked, or outside validity period)`,
    );
  }

  // 2. Verify manifest signature
  const activeKey = findActiveKey(keyList, manifest.key_id);
  if (activeKey) {
    const publicKey = base64ToPublicKey(activeKey.public_key);
    const signatureValid = await verifyManifest(manifest, publicKey);
    if (!signatureValid) {
      errors.push("Manifest signature is invalid");
    }
  }

  // 3. Verify content_hash
  const expectedHash = await computeContentHash(config);
  if (manifest.content_hash !== expectedHash) {
    errors.push(
      `Content hash mismatch: expected ${expectedHash}, got ${manifest.content_hash}`,
    );
  }

  // 4. Verify content_size
  const expectedSize = computeContentSize(config);
  if (manifest.content_size !== expectedSize) {
    errors.push(
      `Content size mismatch: expected ${expectedSize}, got ${manifest.content_size}`,
    );
  }

  return { valid: errors.length === 0, errors };
}
