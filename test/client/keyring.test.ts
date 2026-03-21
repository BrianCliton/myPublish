import { describe, expect, test, beforeAll } from "bun:test";
import { KeyRing } from "../../src/client/keyring.ts";
import {
  generateKeyPair,
  signKeyList,
  publicKeyToBase64,
} from "../../src/core/signing.ts";
import type { KeyList, UnsignedKeyList } from "../../src/core/types.ts";

describe("KeyRing", () => {
  let rootPublicKey: Uint8Array;
  let rootPrivateKey: Uint8Array;
  let signingPublicKey: Uint8Array;
  let signingKeyBase64: string;
  const now = Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    const rootPair = await generateKeyPair();
    rootPublicKey = rootPair.publicKey;
    rootPrivateKey = rootPair.privateKey;
    const signingPair = await generateKeyPair();
    signingPublicKey = signingPair.publicKey;
    signingKeyBase64 = publicKeyToBase64(signingPublicKey);
  });

  async function makeKeyList(
    overrides: Partial<UnsignedKeyList> = {},
  ): Promise<KeyList> {
    const unsigned: UnsignedKeyList = {
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
      ...overrides,
    };
    return signKeyList(unsigned, rootPrivateKey);
  }

  test("initializes with empty key set", () => {
    const ring = new KeyRing(rootPublicKey);
    expect(ring.isKeyTrusted("key-1")).toBe(false);
    expect(ring.getPublicKey("key-1")).toBeNull();
    expect(ring.getListSequence()).toBe(0);
  });

  test("updates from valid key list", async () => {
    const ring = new KeyRing(rootPublicKey);
    const keyList = await makeKeyList();
    const result = await ring.updateFromKeyList(keyList);
    expect(result).toBe(true);
    expect(ring.isKeyTrusted("key-1")).toBe(true);
    expect(ring.getListSequence()).toBe(1);
  });

  test("returns public key for trusted key", async () => {
    const ring = new KeyRing(rootPublicKey);
    const keyList = await makeKeyList();
    await ring.updateFromKeyList(keyList);
    const pk = ring.getPublicKey("key-1");
    expect(pk).not.toBeNull();
    expect(pk!.length).toBe(32);
  });

  test("rejects key list with invalid signature", async () => {
    const ring = new KeyRing(rootPublicKey);
    const otherPair = await generateKeyPair();
    const unsigned: UnsignedKeyList = {
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
    // Sign with wrong key
    const badKeyList = await signKeyList(unsigned, otherPair.privateKey);
    const result = await ring.updateFromKeyList(badKeyList);
    expect(result).toBe(false);
    expect(ring.isKeyTrusted("key-1")).toBe(false);
  });

  test("rejects key list with lower sequence (replay protection)", async () => {
    const ring = new KeyRing(rootPublicKey);
    const keyList1 = await makeKeyList({ list_sequence: 5 });
    await ring.updateFromKeyList(keyList1);

    const keyList2 = await makeKeyList({ list_sequence: 3 });
    const result = await ring.updateFromKeyList(keyList2);
    expect(result).toBe(false);
    expect(ring.getListSequence()).toBe(5);
  });

  test("accepts key list with same sequence", async () => {
    const ring = new KeyRing(rootPublicKey);
    const keyList1 = await makeKeyList({ list_sequence: 5 });
    await ring.updateFromKeyList(keyList1);

    const keyList2 = await makeKeyList({ list_sequence: 5 });
    const result = await ring.updateFromKeyList(keyList2);
    expect(result).toBe(true);
  });

  test("rejects expired key list", async () => {
    const ring = new KeyRing(rootPublicKey);
    const keyList = await makeKeyList({ expires_at: now - 1 });
    const result = await ring.updateFromKeyList(keyList);
    expect(result).toBe(false);
  });

  test("returns null for revoked key", async () => {
    const ring = new KeyRing(rootPublicKey);
    const keyList = await makeKeyList({
      keys: [
        {
          key_id: "key-1",
          public_key: signingKeyBase64,
          status: "revoked",
          not_before: now - 3600,
          not_after: now + 86400,
          revoked_at: now - 1800,
        },
      ],
    });
    await ring.updateFromKeyList(keyList);
    expect(ring.getPublicKey("key-1")).toBeNull();
    expect(ring.isKeyTrusted("key-1")).toBe(false);
  });

  test("returns null for key outside validity window", async () => {
    const ring = new KeyRing(rootPublicKey);
    const keyList = await makeKeyList({
      keys: [
        {
          key_id: "future-key",
          public_key: signingKeyBase64,
          status: "active",
          not_before: now + 3600, // starts in the future
          not_after: now + 86400,
        },
      ],
    });
    await ring.updateFromKeyList(keyList);
    expect(ring.getPublicKey("future-key")).toBeNull();
    expect(ring.isKeyTrusted("future-key")).toBe(false);
  });

  test("returns null for unknown key_id", async () => {
    const ring = new KeyRing(rootPublicKey);
    const keyList = await makeKeyList();
    await ring.updateFromKeyList(keyList);
    expect(ring.getPublicKey("unknown")).toBeNull();
    expect(ring.isKeyTrusted("unknown")).toBe(false);
  });

  test("clears old keys on update", async () => {
    const ring = new KeyRing(rootPublicKey);
    const keyList1 = await makeKeyList({
      list_sequence: 1,
      keys: [
        {
          key_id: "old-key",
          public_key: signingKeyBase64,
          status: "active",
          not_before: now - 3600,
          not_after: now + 86400,
        },
      ],
    });
    await ring.updateFromKeyList(keyList1);
    expect(ring.isKeyTrusted("old-key")).toBe(true);

    const keyList2 = await makeKeyList({
      list_sequence: 2,
      keys: [
        {
          key_id: "new-key",
          public_key: signingKeyBase64,
          status: "active",
          not_before: now - 3600,
          not_after: now + 86400,
        },
      ],
    });
    await ring.updateFromKeyList(keyList2);
    expect(ring.isKeyTrusted("old-key")).toBe(false);
    expect(ring.isKeyTrusted("new-key")).toBe(true);
  });

  test("restoreFromCache populates keys without verification", async () => {
    const keyList = await makeKeyList({ list_sequence: 10 });
    const ring = new KeyRing(rootPublicKey);
    ring.restoreFromCache(keyList, 10);
    expect(ring.isKeyTrusted("key-1")).toBe(true);
    expect(ring.getListSequence()).toBe(10);
  });

  test("handles multiple keys", async () => {
    const pair2 = await generateKeyPair();
    const ring = new KeyRing(rootPublicKey);
    const keyList = await makeKeyList({
      keys: [
        {
          key_id: "key-1",
          public_key: signingKeyBase64,
          status: "active",
          not_before: now - 3600,
          not_after: now + 86400,
        },
        {
          key_id: "key-2",
          public_key: publicKeyToBase64(pair2.publicKey),
          status: "active",
          not_before: now - 3600,
          not_after: now + 86400,
        },
      ],
    });
    await ring.updateFromKeyList(keyList);
    expect(ring.isKeyTrusted("key-1")).toBe(true);
    expect(ring.isKeyTrusted("key-2")).toBe(true);
  });
});
