import type { AdminStore, SigningKeyRow } from "../db/admin-store.ts";
import type { KeyList, UnsignedKeyList } from "../../core/types.ts";
import {
  generateKeyPair,
  publicKeyToBase64,
  uint8ArrayToBase64,
  base64ToUint8Array,
  signKeyList,
} from "../../core/signing.ts";

export interface GenerateKeyResult {
  readonly success: boolean;
  readonly error?: string;
  readonly keyId?: string;
  readonly publicKey?: string;
}

export interface PublishKeyListResult {
  readonly success: boolean;
  readonly error?: string;
  readonly listSequence?: number;
}

function getEncryptionKey(): Uint8Array {
  const key = process.env.KEY_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("KEY_ENCRYPTION_KEY environment variable is required");
  }
  // Derive a 256-bit key from the env variable using SHA-256
  const keyBytes = new TextEncoder().encode(key);
  const hashBuffer = new Bun.CryptoHasher("sha256").update(keyBytes).digest();
  return new Uint8Array(hashBuffer);
}

export async function encryptPrivateKey(privateKeyBytes: Uint8Array): Promise<string> {
  const aesKeyBytes = getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM
  const aesKey = await crypto.subtle.importKey("raw", aesKeyBytes, "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, privateKeyBytes);
  // Format: "aes:" + base64(iv + ciphertext)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return "aes:" + uint8ArrayToBase64(combined);
}

export async function decryptPrivateKey(encrypted: string): Promise<Uint8Array> {
  const aesPrefix = "aes:";
  if (!encrypted.startsWith(aesPrefix)) {
    throw new Error("Unsupported key format: keys must be AES-GCM encrypted (aes: prefix)");
  }
  const aesKeyBytes = getEncryptionKey();
  const combined = base64ToUint8Array(encrypted.slice(aesPrefix.length));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const aesKey = await crypto.subtle.importKey("raw", aesKeyBytes, "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext);
  return new Uint8Array(plaintext);
}

export async function generateSigningKey(
  store: AdminStore,
  validityDays: number = 365,
): Promise<GenerateKeyResult> {
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3650) {
    return { success: false, error: "validity_days must be an integer between 1 and 3650" };
  }

  const { publicKey, privateKey } = await generateKeyPair();

  const keyId = `key-${crypto.randomUUID()}`;
  const pubKeyBase64 = publicKeyToBase64(publicKey);
  const encryptedPrivateKey = await encryptPrivateKey(privateKey);

  const now = Math.floor(Date.now() / 1000);
  const notBefore = now;
  const notAfter = now + validityDays * 86400;

  store.createSigningKey(keyId, pubKeyBase64, encryptedPrivateKey, notBefore, notAfter);

  return {
    success: true,
    keyId,
    publicKey: pubKeyBase64,
  };
}

export function revokeKey(store: AdminStore, keyId: string): { success: boolean; error?: string } {
  const key = store.getSigningKey(keyId);
  if (!key) {
    return { success: false, error: "Key not found" };
  }

  if (key.status === "revoked") {
    return { success: false, error: "Key is already revoked" };
  }

  store.revokeSigningKey(keyId);
  return { success: true };
}

export async function publishKeyList(
  store: AdminStore,
  rootPrivateKeyBase64: string,
): Promise<PublishKeyListResult> {
  const allKeys = store.listSigningKeys();
  if (allKeys.length === 0) {
    return { success: false, error: "No signing keys exist" };
  }

  const rootPrivateKey = base64ToUint8Array(rootPrivateKeyBase64);
  const listSequence = store.getNextKeyListSequence();
  const now = Math.floor(Date.now() / 1000);

  const keys = allKeys.map((k: SigningKeyRow) => ({
    key_id: k.key_id,
    public_key: k.public_key,
    status: k.status as "active" | "revoked",
    not_before: k.not_before,
    not_after: k.not_after,
    ...(k.revoked_at ? { revoked_at: k.revoked_at } : {}),
  }));

  const unsigned: UnsignedKeyList = {
    version: 1,
    list_sequence: listSequence,
    timestamp: now,
    expires_at: now + 86400 * 30,
    keys,
  };

  const signedKeyList = await signKeyList(unsigned, rootPrivateKey);
  const { root_signature, ...content } = signedKeyList;

  store.insertKeyList(listSequence, JSON.stringify(content), root_signature);

  return {
    success: true,
    listSequence,
  };
}
