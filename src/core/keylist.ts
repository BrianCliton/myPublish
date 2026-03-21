import { verifyKeyList } from "./signing.ts";
import type { KeyList, SigningKeyEntry } from "./types.ts";

/**
 * Validate a KeyList's root signature and structural integrity.
 */
export async function validateKeyList(
  keyList: KeyList,
  rootPublicKey: Uint8Array,
): Promise<{ valid: boolean; error?: string }> {
  const signatureValid = await verifyKeyList(keyList, rootPublicKey);
  if (!signatureValid) {
    return { valid: false, error: "Invalid root signature" };
  }

  if (keyList.version < 1) {
    return { valid: false, error: "KeyList version must be >= 1" };
  }

  if (keyList.keys.length === 0) {
    return { valid: false, error: "KeyList must contain at least one key" };
  }

  const keyIds = new Set<string>();
  for (const key of keyList.keys) {
    if (keyIds.has(key.key_id)) {
      return {
        valid: false,
        error: `Duplicate key_id: ${key.key_id}`,
      };
    }
    keyIds.add(key.key_id);

    if (key.not_after <= key.not_before) {
      return {
        valid: false,
        error: `Key ${key.key_id}: not_after must be after not_before`,
      };
    }

    if (key.status === "revoked" && key.revoked_at === undefined) {
      return {
        valid: false,
        error: `Key ${key.key_id}: revoked key must have revoked_at`,
      };
    }
  }

  return { valid: true };
}

/**
 * Find an active key entry by key_id.
 */
export function findActiveKey(
  keyList: KeyList,
  keyId: string,
): SigningKeyEntry | undefined {
  return keyList.keys.find(
    (key) => key.key_id === keyId && key.status === "active",
  );
}

/**
 * Check if a key is authorized: active status and within validity period.
 */
export function isKeyAuthorized(
  keyList: KeyList,
  keyId: string,
  now?: number,
): boolean {
  const key = findActiveKey(keyList, keyId);
  if (!key) {
    return false;
  }
  const currentTime = now ?? Math.floor(Date.now() / 1000);
  return currentTime >= key.not_before && currentTime < key.not_after;
}
