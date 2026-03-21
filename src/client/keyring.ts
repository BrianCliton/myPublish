import { base64ToPublicKey, verifyKeyList } from "../core/signing.ts";
import type { KeyList, SigningKeyEntry } from "../core/types.ts";

export class KeyRing {
  private readonly rootPublicKey: Uint8Array;
  private keys: Map<string, SigningKeyEntry> = new Map();
  private listSequence: number = 0;

  constructor(rootPublicKey: Uint8Array) {
    this.rootPublicKey = rootPublicKey;
  }

  /**
   * Update the keyring from a verified KeyList response.
   * Returns true if the keyring was updated, false if rejected.
   */
  async updateFromKeyList(keyList: KeyList): Promise<boolean> {
    // Reject if sequence is not advancing (replay protection)
    if (keyList.list_sequence < this.listSequence) {
      return false;
    }

    // Verify root signature
    const valid = await verifyKeyList(keyList, this.rootPublicKey);
    if (!valid) {
      return false;
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (keyList.expires_at <= now) {
      return false;
    }

    // Update local keys
    this.keys.clear();
    for (const entry of keyList.keys) {
      this.keys.set(entry.key_id, entry);
    }
    this.listSequence = keyList.list_sequence;
    return true;
  }

  /**
   * Get a public key if the key_id exists, is active, and within validity period.
   */
  getPublicKey(keyId: string): Uint8Array | null {
    const entry = this.keys.get(keyId);
    if (!entry || entry.status !== "active") {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (now < entry.not_before || now >= entry.not_after) {
      return null;
    }
    return base64ToPublicKey(entry.public_key);
  }

  /**
   * Check if a key is trusted (exists, active, within validity window).
   */
  isKeyTrusted(keyId: string): boolean {
    return this.getPublicKey(keyId) !== null;
  }

  /**
   * Get the current list sequence number.
   */
  getListSequence(): number {
    return this.listSequence;
  }

  /**
   * Restore keyring state from a cached KeyList (no signature verification).
   * Used when loading persisted state on startup.
   */
  restoreFromCache(keyList: KeyList, listSequence: number): void {
    this.keys.clear();
    for (const entry of keyList.keys) {
      this.keys.set(entry.key_id, entry);
    }
    this.listSequence = listSequence;
  }
}
