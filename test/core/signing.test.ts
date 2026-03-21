import { describe, expect, test } from "bun:test";
import {
  base64ToPublicKey,
  base64ToUint8Array,
  generateKeyPair,
  publicKeyToBase64,
  signKeyList,
  signManifest,
  uint8ArrayToBase64,
  verifyKeyList,
  verifyManifest,
} from "../../src/core/signing.ts";
import type { UnsignedKeyList, UnsignedManifest } from "../../src/core/types.ts";

describe("generateKeyPair", () => {
  test("generates valid key pair", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(privateKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(32);
    expect(privateKey.length).toBe(32);
  });

  test("generates unique keys each time", async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    expect(uint8ArrayToBase64(kp1.publicKey)).not.toBe(
      uint8ArrayToBase64(kp2.publicKey),
    );
  });
});

describe("Manifest signing", () => {
  test("sign and verify roundtrip", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const unsigned: UnsignedManifest = {
      version: 1,
      content_hash: "sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
      content_size: 256,
      key_id: "key-1",
      timestamp: Math.floor(Date.now() / 1000),
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };

    const signed = await signManifest(unsigned, privateKey);
    expect(signed.signature).toBeTruthy();
    expect(signed.version).toBe(unsigned.version);

    const valid = await verifyManifest(signed, publicKey);
    expect(valid).toBe(true);
  });

  test("verification fails with wrong key", async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();

    const unsigned: UnsignedManifest = {
      version: 1,
      content_hash: "sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
      content_size: 256,
      key_id: "key-1",
      timestamp: Math.floor(Date.now() / 1000),
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };

    const signed = await signManifest(unsigned, kp1.privateKey);
    const valid = await verifyManifest(signed, kp2.publicKey);
    expect(valid).toBe(false);
  });

  test("verification fails with tampered manifest", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const unsigned: UnsignedManifest = {
      version: 1,
      content_hash: "sha256:abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
      content_size: 256,
      key_id: "key-1",
      timestamp: Math.floor(Date.now() / 1000),
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    };

    const signed = await signManifest(unsigned, privateKey);
    const tampered = { ...signed, version: 2 };
    const valid = await verifyManifest(tampered, publicKey);
    expect(valid).toBe(false);
  });
});

describe("KeyList signing", () => {
  test("sign and verify roundtrip", async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const signingKp = await generateKeyPair();

    const unsigned: UnsignedKeyList = {
      version: 1,
      list_sequence: 1,
      timestamp: Math.floor(Date.now() / 1000),
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      keys: [
        {
          key_id: "signing-key-1",
          public_key: publicKeyToBase64(signingKp.publicKey),
          status: "active",
          not_before: Math.floor(Date.now() / 1000) - 3600,
          not_after: Math.floor(Date.now() / 1000) + 86400,
        },
      ],
    };

    const signed = await signKeyList(unsigned, privateKey);
    expect(signed.root_signature).toBeTruthy();

    const valid = await verifyKeyList(signed, publicKey);
    expect(valid).toBe(true);
  });

  test("verification fails with wrong root key", async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();

    const unsigned: UnsignedKeyList = {
      version: 1,
      list_sequence: 1,
      timestamp: Math.floor(Date.now() / 1000),
      expires_at: Math.floor(Date.now() / 1000) + 86400,
      keys: [
        {
          key_id: "k1",
          public_key: publicKeyToBase64(kp1.publicKey),
          status: "active",
          not_before: 0,
          not_after: Math.floor(Date.now() / 1000) + 86400,
        },
      ],
    };

    const signed = await signKeyList(unsigned, kp1.privateKey);
    const valid = await verifyKeyList(signed, kp2.publicKey);
    expect(valid).toBe(false);
  });
});

describe("Encoding helpers", () => {
  test("uint8ArrayToBase64 and base64ToUint8Array roundtrip", () => {
    const original = new Uint8Array([0, 1, 2, 255, 128, 64]);
    const base64 = uint8ArrayToBase64(original);
    const decoded = base64ToUint8Array(base64);
    expect(decoded).toEqual(original);
  });

  test("publicKeyToBase64 and base64ToPublicKey roundtrip", async () => {
    const { publicKey } = await generateKeyPair();
    const base64 = publicKeyToBase64(publicKey);
    const decoded = base64ToPublicKey(base64);
    expect(decoded).toEqual(publicKey);
  });
});
