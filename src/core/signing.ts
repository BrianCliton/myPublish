import * as ed from "@noble/ed25519";
import { canonicalJson } from "./canonical.ts";
import type {
  KeyList,
  Manifest,
  UnsignedKeyList,
  UnsignedManifest,
} from "./types.ts";

// --- Key Generation ---

export async function generateKeyPair(): Promise<{
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}> {
  const privateKey = ed.utils.randomSecretKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { publicKey, privateKey };
}

// --- Manifest Signing ---

export async function signManifest(
  unsigned: UnsignedManifest,
  privateKey: Uint8Array,
): Promise<Manifest> {
  const payload = canonicalJson(unsigned);
  const payloadBytes = new TextEncoder().encode(payload);
  const signature = await ed.signAsync(payloadBytes, privateKey);
  return {
    ...unsigned,
    signature: uint8ArrayToBase64(signature),
  };
}

export async function verifyManifest(
  manifest: Manifest,
  publicKey: Uint8Array,
): Promise<boolean> {
  const { signature, ...unsigned } = manifest;
  const payload = canonicalJson(unsigned);
  const payloadBytes = new TextEncoder().encode(payload);
  const signatureBytes = base64ToUint8Array(signature);
  return ed.verifyAsync(signatureBytes, payloadBytes, publicKey);
}

// --- KeyList Signing ---

export async function signKeyList(
  unsigned: UnsignedKeyList,
  rootPrivateKey: Uint8Array,
): Promise<KeyList> {
  const payload = canonicalJson(unsigned);
  const payloadBytes = new TextEncoder().encode(payload);
  const signature = await ed.signAsync(payloadBytes, rootPrivateKey);
  return {
    ...unsigned,
    root_signature: uint8ArrayToBase64(signature),
  };
}

export async function verifyKeyList(
  keyList: KeyList,
  rootPublicKey: Uint8Array,
): Promise<boolean> {
  const { root_signature, ...unsigned } = keyList;
  const payload = canonicalJson(unsigned);
  const payloadBytes = new TextEncoder().encode(payload);
  const signatureBytes = base64ToUint8Array(root_signature);
  return ed.verifyAsync(signatureBytes, payloadBytes, rootPublicKey);
}

// --- Encoding Helpers ---

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function publicKeyToBase64(publicKey: Uint8Array): string {
  return uint8ArrayToBase64(publicKey);
}

export function base64ToPublicKey(base64: string): Uint8Array {
  return base64ToUint8Array(base64);
}
