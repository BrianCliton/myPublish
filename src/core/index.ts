// Types and schemas
export {
  type Announcement,
  AnnouncementSchema,
  type Config,
  ConfigSchema,
  type KeyList,
  KeyListSchema,
  type Manifest,
  ManifestSchema,
  type PublishResponse,
  PublishResponseSchema,
  type SigningKeyEntry,
  SigningKeyEntrySchema,
  type UnsignedKeyList,
  type UnsignedManifest,
} from "./types.ts";

// Canonical JSON
export { canonicalJson } from "./canonical.ts";

// Hashing
export {
  computeContentHash,
  computeContentSize,
  verifyContentHash,
} from "./hash.ts";

// Signing
export {
  base64ToPublicKey,
  base64ToUint8Array,
  generateKeyPair,
  publicKeyToBase64,
  signKeyList,
  signManifest,
  uint8ArrayToBase64,
  verifyKeyList,
  verifyManifest,
} from "./signing.ts";

// Key list management
export { findActiveKey, isKeyAuthorized, validateKeyList } from "./keylist.ts";

// Full validation
export {
  validateManifestAndConfig,
  type ValidationResult,
} from "./validation.ts";
