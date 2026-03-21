# Client Implementation Guide

> PMA Publish — Secure Configuration Distribution System
>
> This guide provides everything iOS, Android, and other platform clients need to implement secure configuration fetching, verification, and application.

## Table of Contents

1. [Overview](#overview)
2. [Security Model](#security-model)
3. [Data Structures](#data-structures)
4. [API Reference](#api-reference)
5. [Cryptographic Operations](#cryptographic-operations)
6. [Verification Pipeline](#verification-pipeline)
7. [Client Architecture](#client-architecture)
8. [Platform-Specific Implementation](#platform-specific-implementation)
9. [Polling Strategy](#polling-strategy)
10. [State Persistence](#state-persistence)
11. [Error Handling](#error-handling)
12. [Security Checklist](#security-checklist)
13. [Testing Guide](#testing-guide)

---

## Overview

PMA Publish distributes signed application configurations using **ed25519 digital signatures**. Clients fetch configurations from a server and cryptographically verify their integrity and authenticity before applying them.

**Key Properties:**

- All configurations are signed — tampering is detectable
- Two-layer key system — signing keys can rotate without client updates
- Offline-capable — clients cache the last valid configuration
- Lightweight polling — manifest-only endpoint for efficient version checks

---

## Security Model

### Two-Layer Key System

```
Root Key (hardcoded in client, never rotated)
  │
  ├── Signs → KeyList (list of signing keys + status)
  │              │
  │              ├── signing-key-001 (active)
  │              ├── signing-key-002 (active)
  │              └── signing-key-003 (revoked)
  │
  └── Signing Keys sign → Config Manifests
                              │
                              └── manifest.signature verifies config integrity
```

| Key Type | Storage | Rotation | Purpose |
|----------|---------|----------|---------|
| **Root Key** | Hardcoded in client binary | Never (requires app update) | Signs KeyLists |
| **Signing Keys** | Server-side, encrypted | Rotatable via KeyList updates | Sign config manifests |

### Trust Chain

```
Root Public Key (hardcoded)
  → verifies KeyList.root_signature
    → extracts active signing key public keys
      → verifies Manifest.signature
        → content_hash verifies Config integrity
```

**The client MUST hardcode the root public key.** This is the single trust anchor. If the root key is compromised, a client update is required.

---

## Data Structures

### KeyList

The KeyList contains all signing keys and their status. It is signed by the root key.

```json
{
  "version": 1,
  "list_sequence": 3,
  "timestamp": 1711036800,
  "expires_at": 1742572800,
  "keys": [
    {
      "key_id": "sk-20260321-001",
      "public_key": "<base64-encoded-ed25519-public-key>",
      "status": "active",
      "not_before": 1711036800,
      "not_after": 1742572800
    },
    {
      "key_id": "sk-20260101-001",
      "public_key": "<base64-encoded-ed25519-public-key>",
      "status": "revoked",
      "revoked_at": 1711036800,
      "not_before": 1704067200,
      "not_after": 1735689600
    }
  ],
  "root_signature": "<base64-encoded-ed25519-signature>"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | integer (>= 1) | Schema version |
| `list_sequence` | integer (>= 0) | Monotonically increasing sequence number; used for replay protection |
| `timestamp` | integer (unix seconds) | When this KeyList was created |
| `expires_at` | integer (unix seconds) | Expiration time; reject if `now >= expires_at` |
| `keys` | array | List of signing key entries |
| `root_signature` | string (base64) | Ed25519 signature over the canonical JSON of all fields except `root_signature` |

### SigningKeyEntry

| Field | Type | Description |
|-------|------|-------------|
| `key_id` | string | Unique identifier for the signing key |
| `public_key` | string (base64) | Ed25519 public key (32 bytes, base64-encoded) |
| `status` | `"active"` \| `"revoked"` | Current status |
| `not_before` | integer (unix seconds) | Key is valid starting from this time |
| `not_after` | integer (unix seconds) | Key is valid until this time (exclusive) |
| `revoked_at` | integer (unix seconds, optional) | When the key was revoked; required if status is `"revoked"` |

### Manifest

The manifest contains signed metadata about a configuration. It is signed by a signing key.

```json
{
  "version": 5,
  "content_hash": "sha256:a1b2c3d4e5f6...64hex",
  "content_size": 1024,
  "key_id": "sk-20260321-001",
  "timestamp": 1711036800,
  "expires_at": 1742572800,
  "signature": "<base64-encoded-ed25519-signature>"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `version` | integer (>= 1) | Config version number, monotonically increasing |
| `content_hash` | string | `sha256:<64-char-lowercase-hex>` hash of canonical JSON config |
| `content_size` | integer (>= 0) | Byte length of the canonical JSON config |
| `key_id` | string | ID of the signing key that produced `signature` |
| `timestamp` | integer (unix seconds) | When this manifest was signed |
| `expires_at` | integer (unix seconds) | Reject if `now >= expires_at` |
| `signature` | string (base64) | Ed25519 signature over canonical JSON of all fields except `signature` |

### Config

The configuration payload. Schema is flexible and can evolve independently of the signing system.

```json
{
  "update": {
    "latest_version": "2.1.0",
    "min_version": "1.8.0",
    "download_url": "https://example.com/app-2.1.0.apk",
    "sha256": "abc123...",
    "release_notes": "Bug fixes and performance improvements",
    "force": false
  },
  "endpoints": {
    "api": "https://api.example.com",
    "cdn": "https://cdn.example.com"
  },
  "features": {
    "dark_mode": true,
    "new_onboarding": false,
    "experimental_search": true
  },
  "announcements": [
    {
      "id": "ann-001",
      "type": "banner",
      "content": "Scheduled maintenance on March 25",
      "priority": 1,
      "expires_at": 1711584000,
      "display_rule": "daily"
    }
  ],
  "custom": {
    "rate_limit": 100,
    "cache_ttl": 3600
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `update` | object (optional) | App version control: forced updates, latest version info |
| `endpoints` | map<string, string> (optional) | Dynamic API endpoint URLs |
| `features` | map<string, boolean> (optional) | Feature flags |
| `announcements` | array (optional) | In-app announcements |
| `custom` | map<string, any> (optional) | Arbitrary key-value data |

### Announcement

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique announcement identifier |
| `type` | `"banner"` \| `"popup"` \| `"toast"` \| `"fullscreen"` | Display type |
| `title` | string (optional) | Title text |
| `content` | string | Body content |
| `action_url` | string (optional) | URL to open on tap |
| `image_url` | string (optional) | Image URL |
| `priority` | integer | Display priority (lower = higher priority) |
| `starts_at` | integer (optional, unix seconds) | Start showing at this time |
| `expires_at` | integer (unix seconds) | Stop showing after this time |
| `display_rule` | `"once"` \| `"every_launch"` \| `"daily"` (optional) | How often to display |
| `target_versions` | string (optional) | Semver range for version targeting |

---

## API Reference

All endpoints are unauthenticated. Base URL: `https://your-server.example.com/v1`

### GET /v1/keys

Returns the latest root-signed KeyList.

**Response (200):**
```json
{
  "version": 1,
  "list_sequence": 3,
  "timestamp": 1711036800,
  "expires_at": 1742572800,
  "keys": [...],
  "root_signature": "..."
}
```

**Response (404):** No KeyList published yet.

### GET /v1/config/latest

Returns the latest published config with its manifest.

**Request Headers:**
- `If-None-Match: "v5"` — ETag for cache validation

**Response (200):**
```json
{
  "manifest": { ... },
  "config": { ... }
}
```

**Response (304):** Config has not changed (ETag match).

**Response (404):** No config published yet.

**Response Header:**
- `ETag: "v5"` — Version-based ETag

### GET /v1/config/latest/manifest

Returns **only** the manifest (lightweight version check). Use this endpoint to avoid downloading the full config when only checking for updates.

**Request Headers:**
- `If-None-Match: "v5"` — ETag for cache validation

**Response (200):**
```json
{
  "manifest": { ... }
}
```

**Response (304):** Manifest has not changed.

### GET /v1/config/:version

Returns a specific published config version.

**Response (200):**
```json
{
  "manifest": { ... },
  "config": { ... }
}
```

**Response (400):** Invalid version number.

**Response (404):** Version not found or not published.

---

## Cryptographic Operations

### Ed25519 Signature Verification

All signatures use **Ed25519** (RFC 8032). The signed payload is always the **canonical JSON** representation of the object, excluding the signature field itself.

**Required Libraries:**

| Platform | Library | Notes |
|----------|---------|-------|
| **iOS (Swift)** | `CryptoKit` (built-in) | `Curve25519.Signing` available since iOS 13 |
| **Android (Kotlin)** | `BouncyCastle` or `Tink` | Android API doesn't include ed25519 natively |
| **Flutter/Dart** | `cryptography` package | `Ed25519()` class |
| **React Native** | `react-native-ed25519` or `libsodium` bindings | Consider `TweetNaCl` for JS-only |

### Canonical JSON Algorithm

**This is critical for signature verification.** The server signs the canonical JSON form of data. Clients MUST produce identical canonical JSON to verify signatures.

**Rules:**

1. Object keys are sorted by Unicode code point, ascending, **recursively**
2. No extra whitespace (no spaces after `:` or `,`)
3. Standard JSON string escaping
4. Numbers: standard JSON number format (no trailing zeros beyond JSON spec)
5. `null` is serialized as `null`
6. No `undefined` values (must not appear)
7. Arrays preserve element order

**Example:**

Input:
```json
{"b": 2, "a": 1, "c": {"z": true, "y": false}}
```

Canonical output:
```
{"a":1,"b":2,"c":{"y":false,"z":true}}
```

**Pseudocode:**

```
function canonicalJson(value):
  if value is null:
    return "null"
  if value is boolean:
    return value ? "true" : "false"
  if value is number:
    if not finite: throw error
    return standard JSON number representation
  if value is string:
    return JSON-escaped string with quotes
  if value is array:
    return "[" + items.map(canonicalJson).join(",") + "]"
  if value is object:
    keys = sort(object.keys) by Unicode code point
    pairs = keys.map(k => jsonEscape(k) + ":" + canonicalJson(value[k]))
    return "{" + pairs.join(",") + "}"
```

### Verifying a KeyList Signature

```
function verifyKeyList(keyList, rootPublicKey):
  // 1. Extract signature
  rootSignature = base64Decode(keyList.root_signature)

  // 2. Build unsigned object (all fields EXCEPT root_signature)
  unsigned = {
    version: keyList.version,
    list_sequence: keyList.list_sequence,
    timestamp: keyList.timestamp,
    expires_at: keyList.expires_at,
    keys: keyList.keys
  }

  // 3. Compute canonical JSON
  payload = canonicalJson(unsigned)
  payloadBytes = utf8Encode(payload)

  // 4. Verify ed25519 signature
  return ed25519Verify(rootSignature, payloadBytes, rootPublicKey)
```

### Verifying a Manifest Signature

```
function verifyManifest(manifest, signingPublicKey):
  // 1. Extract signature
  signature = base64Decode(manifest.signature)

  // 2. Build unsigned object (all fields EXCEPT signature)
  unsigned = {
    version: manifest.version,
    content_hash: manifest.content_hash,
    content_size: manifest.content_size,
    key_id: manifest.key_id,
    timestamp: manifest.timestamp,
    expires_at: manifest.expires_at
  }

  // 3. Compute canonical JSON
  payload = canonicalJson(unsigned)
  payloadBytes = utf8Encode(payload)

  // 4. Verify ed25519 signature
  return ed25519Verify(signature, payloadBytes, signingPublicKey)
```

### Content Hash Verification

```
function verifyContentHash(config, expectedHash):
  canonical = canonicalJson(config)
  bytes = utf8Encode(canonical)
  hash = sha256(bytes)
  hex = lowercase_hex(hash)
  return expectedHash == "sha256:" + hex

function verifyContentSize(config, expectedSize):
  canonical = canonicalJson(config)
  bytes = utf8Encode(canonical)
  return expectedSize == bytes.length
```

---

## Verification Pipeline

Every config fetch MUST go through the full verification pipeline. **Never skip any step.**

```
┌──────────────────────────────────────────────────────────┐
│                   VERIFICATION PIPELINE                   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Step 1: Verify KeyList root signature                   │
│    └─ ed25519.verify(root_signature, unsigned, rootPK)   │
│    └─ REJECT if invalid → do not trust any keys          │
│                                                          │
│  Step 2: Check KeyList expiry                            │
│    └─ REJECT if now >= keyList.expires_at                │
│                                                          │
│  Step 3: Find signing key by manifest.key_id             │
│    └─ REJECT if key not found in KeyList                 │
│    └─ REJECT if key.status != "active"                   │
│    └─ REJECT if now < key.not_before                     │
│    └─ REJECT if now >= key.not_after                     │
│                                                          │
│  Step 4: Verify manifest signature                       │
│    └─ ed25519.verify(signature, unsigned, signingPK)     │
│    └─ REJECT if invalid                                  │
│                                                          │
│  Step 5: Verify content hash                             │
│    └─ sha256(canonicalJson(config)) == content_hash      │
│    └─ REJECT if mismatch                                 │
│                                                          │
│  Step 6: Verify content size                             │
│    └─ utf8ByteLength(canonicalJson(config)) == size      │
│    └─ REJECT if mismatch                                 │
│                                                          │
│  Step 7: Check manifest expiry                           │
│    └─ REJECT if now >= manifest.expires_at               │
│                                                          │
│  Step 8: Check version is advancing                      │
│    └─ REJECT if manifest.version <= cached version       │
│                                                          │
│  ✅ ALL PASSED → Apply config                            │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**On rejection:** Fall back to the cached config. Log the error for debugging. Do NOT apply the new config.

---

## Client Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     PublishClient                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐   │
│  │  Poller   │───▶│ KeyRing  │    │ State Persistence │  │
│  │          │    │          │    │                  │   │
│  │ - timer  │    │ - keys   │    │ - last version   │   │
│  │ - backoff│    │ - seq    │    │ - cached config  │   │
│  │ - ETag   │    │ - rootPK │    │ - cached keylist │   │
│  └──────────┘    └──────────┘    └──────────────────┘   │
│       │                                    ▲            │
│       ▼                                    │            │
│  ┌──────────────────────────────────────────┐           │
│  │         Verification Pipeline            │           │
│  │  (canonicalJson + ed25519 + sha256)      │           │
│  └──────────────────────────────────────────┘           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Initialization

```
function initialize(serverUrl, rootPublicKeyBase64, statePath):
  rootPublicKey = base64Decode(rootPublicKeyBase64)   // 32 bytes
  keyRing = new KeyRing(rootPublicKey)
  state = loadState(statePath)                         // from disk

  // Restore KeyRing from cached state
  if state.cached_key_list != null:
    keyRing.restoreFromCache(state.cached_key_list, state.last_list_sequence)

  poller = new Poller(serverUrl, keyRing, rootPublicKey)
  poller.start()
```

### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `serverUrl` | (required) | Base URL of the publish server |
| `rootPublicKey` | (required) | Base64-encoded ed25519 root public key (32 bytes) |
| `pollInterval` | `3600` (1 hour) | Seconds between polls |
| `statePath` | (platform-specific) | Path for persisting client state |

---

## Platform-Specific Implementation

### iOS (Swift)

```swift
import CryptoKit
import Foundation

// MARK: - Root Public Key (hardcoded)
let rootPublicKeyBase64 = "YOUR_ROOT_PUBLIC_KEY_BASE64"

// MARK: - Canonical JSON
func canonicalJson(_ value: Any) -> String {
    if value is NSNull {
        return "null"
    }
    if let bool = value as? Bool {
        return bool ? "true" : "false"
    }
    if let number = value as? NSNumber {
        // Check if it's a boolean (NSNumber wraps both)
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            return number.boolValue ? "true" : "false"
        }
        if number.doubleValue.truncatingRemainder(dividingBy: 1) == 0
            && abs(number.doubleValue) < Double(Int64.max) {
            return "\(number.int64Value)"
        }
        return "\(number.doubleValue)"
    }
    if let string = value as? String {
        // Use JSONSerialization for proper escaping
        let data = try! JSONSerialization.data(
            withJSONObject: [string], options: .fragmentsAllowed
        )
        let array = String(data: data, encoding: .utf8)!
        // Extract the string from the array: ["..."] -> "..."
        let start = array.index(after: array.startIndex)
        let end = array.index(before: array.endIndex)
        return String(array[start..<end])
    }
    if let array = value as? [Any] {
        let items = array.map { canonicalJson($0) }
        return "[" + items.joined(separator: ",") + "]"
    }
    if let dict = value as? [String: Any] {
        let sortedKeys = dict.keys.sorted()
        let pairs = sortedKeys.map { key -> String in
            let escapedKey = canonicalJson(key)
            let val = canonicalJson(dict[key]!)
            return "\(escapedKey):\(val)"
        }
        return "{" + pairs.joined(separator: ",") + "}"
    }
    fatalError("Unsupported type: \(type(of: value))")
}

// MARK: - Ed25519 Verification
func verifyEd25519(
    signature: Data, message: Data, publicKey: Data
) -> Bool {
    guard let key = try? Curve25519.Signing.PublicKey(
        rawRepresentation: publicKey
    ) else {
        return false
    }
    return key.isValidSignature(signature, for: message)
}

// MARK: - KeyList Verification
func verifyKeyList(
    _ keyList: [String: Any], rootPublicKey: Data
) -> Bool {
    guard let rootSigBase64 = keyList["root_signature"] as? String,
          let rootSig = Data(base64Encoded: rootSigBase64) else {
        return false
    }

    // Build unsigned: all fields except root_signature
    var unsigned = keyList
    unsigned.removeValue(forKey: "root_signature")

    let payload = canonicalJson(unsigned)
    let payloadData = payload.data(using: .utf8)!

    return verifyEd25519(
        signature: rootSig, message: payloadData, publicKey: rootPublicKey
    )
}

// MARK: - Manifest Verification
func verifyManifest(
    _ manifest: [String: Any], signingPublicKey: Data
) -> Bool {
    guard let sigBase64 = manifest["signature"] as? String,
          let sig = Data(base64Encoded: sigBase64) else {
        return false
    }

    var unsigned = manifest
    unsigned.removeValue(forKey: "signature")

    let payload = canonicalJson(unsigned)
    let payloadData = payload.data(using: .utf8)!

    return verifyEd25519(
        signature: sig, message: payloadData, publicKey: signingPublicKey
    )
}

// MARK: - Content Hash Verification
func verifyContentHash(
    _ config: [String: Any], expectedHash: String
) -> Bool {
    let canonical = canonicalJson(config)
    let data = canonical.data(using: .utf8)!
    let hash = SHA256.hash(data: data)
    let hex = hash.map { String(format: "%02x", $0) }.joined()
    return expectedHash == "sha256:\(hex)"
}

func verifyContentSize(
    _ config: [String: Any], expectedSize: Int
) -> Bool {
    let canonical = canonicalJson(config)
    let data = canonical.data(using: .utf8)!
    return expectedSize == data.count
}
```

### Android (Kotlin)

```kotlin
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.security.MessageDigest
import java.util.Base64

// Root public key (hardcoded)
const val ROOT_PUBLIC_KEY_BASE64 = "YOUR_ROOT_PUBLIC_KEY_BASE64"

// Canonical JSON
fun canonicalJson(value: Any?): String = when (value) {
    null -> "null"
    is Boolean -> if (value) "true" else "false"
    is Number -> {
        if (!value.toDouble().isFinite()) {
            throw IllegalArgumentException("Non-finite number")
        }
        if (value.toDouble() == value.toLong().toDouble()) {
            value.toLong().toString()
        } else {
            value.toDouble().toString()
        }
    }
    is String -> buildString {
        append('"')
        for (ch in value) {
            when (ch) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (ch.code < 0x20) {
                    append("\\u%04x".format(ch.code))
                } else {
                    append(ch)
                }
            }
        }
        append('"')
    }
    is List<*> -> value.joinToString(",", "[", "]") { canonicalJson(it) }
    is Map<*, *> -> {
        @Suppress("UNCHECKED_CAST")
        val map = value as Map<String, Any?>
        map.keys.sorted().joinToString(",", "{", "}") { key ->
            "${canonicalJson(key)}:${canonicalJson(map[key])}"
        }
    }
    else -> throw IllegalArgumentException("Unsupported type: ${value::class}")
}

// Ed25519 verification using BouncyCastle
fun verifyEd25519(signature: ByteArray, message: ByteArray, publicKey: ByteArray): Boolean {
    val pubKeyParams = Ed25519PublicKeyParameters(publicKey, 0)
    val signer = Ed25519Signer()
    signer.init(false, pubKeyParams)
    signer.update(message, 0, message.size)
    return signer.verifySignature(signature)
}

// KeyList verification
fun verifyKeyList(keyList: Map<String, Any?>, rootPublicKey: ByteArray): Boolean {
    val rootSigBase64 = keyList["root_signature"] as? String ?: return false
    val rootSig = Base64.getDecoder().decode(rootSigBase64)

    val unsigned = keyList.toMutableMap()
    unsigned.remove("root_signature")

    val payload = canonicalJson(unsigned).toByteArray(Charsets.UTF_8)
    return verifyEd25519(rootSig, payload, rootPublicKey)
}

// Manifest verification
fun verifyManifest(manifest: Map<String, Any?>, signingPublicKey: ByteArray): Boolean {
    val sigBase64 = manifest["signature"] as? String ?: return false
    val sig = Base64.getDecoder().decode(sigBase64)

    val unsigned = manifest.toMutableMap()
    unsigned.remove("signature")

    val payload = canonicalJson(unsigned).toByteArray(Charsets.UTF_8)
    return verifyEd25519(sig, payload, signingPublicKey)
}

// Content hash verification
fun verifyContentHash(config: Map<String, Any?>, expectedHash: String): Boolean {
    val canonical = canonicalJson(config).toByteArray(Charsets.UTF_8)
    val digest = MessageDigest.getInstance("SHA-256").digest(canonical)
    val hex = digest.joinToString("") { "%02x".format(it) }
    return expectedHash == "sha256:$hex"
}

fun verifyContentSize(config: Map<String, Any?>, expectedSize: Int): Boolean {
    val canonical = canonicalJson(config).toByteArray(Charsets.UTF_8)
    return expectedSize == canonical.size
}
```

---

## Polling Strategy

### Flow

```
start()
  │
  ▼
[Immediate first poll]
  │
  ├── Success → schedule next poll at pollInterval
  │
  └── Error → schedule next poll with exponential backoff
                │
                ▼
          interval = min(pollInterval × 2^errors, 86400s)
          interval += jitter(±10%)
```

### Algorithm

```
BASE_INTERVAL = 3600          // 1 hour (configurable)
MAX_BACKOFF   = 86400         // 24 hours
JITTER_FACTOR = 0.10          // ±10%

consecutiveErrors = 0

function getNextInterval():
  if consecutiveErrors > 0:
    backoff = min(BASE_INTERVAL * 2^consecutiveErrors, MAX_BACKOFF)
  else:
    backoff = BASE_INTERVAL

  jitter = backoff * JITTER_FACTOR * random(-1, 1)
  return max(0, backoff + jitter)

function poll():
  try:
    result = doPoll()
    consecutiveErrors = 0
  catch error:
    consecutiveErrors++
    logError(error)

  scheduleNext(getNextInterval())
```

### Poll Sequence

Each poll cycle consists of these steps:

```
1. GET /v1/keys
   └─ If list_sequence > cached: verify root sig → update KeyRing
   └─ Failure is non-fatal (continue with cached keys)

2. GET /v1/config/latest/manifest   (lightweight check)
   └─ If version <= cached version: STOP (no update)
   └─ Use ETag/If-None-Match for 304 responses

3. GET /v1/config/latest            (full config)
   └─ Run full verification pipeline
   └─ If valid: cache + apply config
   └─ If invalid: reject, keep cached config
```

### ETag Support

The server returns `ETag: "v{version}"` headers. Clients SHOULD send `If-None-Match` headers to avoid unnecessary data transfer:

```
Request:
  GET /v1/config/latest/manifest
  If-None-Match: "v5"

Response (no change):
  304 Not Modified
  (empty body)

Response (new version):
  200 OK
  ETag: "v6"
  {"manifest": {...}}
```

---

## State Persistence

Clients MUST persist state to survive app restarts. On startup, load state from disk. On each successful config update, write state to disk.

### State Structure

```json
{
  "last_config_version": 5,
  "last_list_sequence": 3,
  "cached_manifest": { ... },
  "cached_config": { ... },
  "cached_key_list": { ... }
}
```

### Platform Storage Recommendations

| Platform | Storage | Path |
|----------|---------|------|
| **iOS** | `FileManager` in app's Application Support directory | `<AppSupport>/pma-publish-state.json` |
| **Android** | Internal storage via `Context.filesDir` | `<filesDir>/pma-publish-state.json` |
| **Flutter** | `path_provider` → `getApplicationDocumentsDirectory()` | `<docs>/pma-publish-state.json` |
| **React Native** | `AsyncStorage` or `react-native-fs` | Key: `pma-publish-state` |

### Startup Behavior

```
function onAppStart():
  state = loadStateFromDisk()

  if state.cached_key_list != null:
    keyRing.restoreFromCache(state.cached_key_list, state.last_list_sequence)

  if state.cached_config != null:
    applyConfig(state.cached_config)   // use cached config immediately

  poller.start()                       // begin polling for updates
```

### Corruption Handling

If state JSON is corrupted or unparseable, reset to defaults:

```json
{
  "last_config_version": 0,
  "last_list_sequence": 0,
  "cached_manifest": null,
  "cached_config": null,
  "cached_key_list": null
}
```

---

## Error Handling

### Error Categories

| Category | Behavior | Retry |
|----------|----------|-------|
| **Network error** | Use cached config, enter backoff | Yes |
| **HTTP 404** | No config published yet; use defaults | Yes (normal interval) |
| **HTTP 304** | No change; continue using cached | Yes (normal interval) |
| **HTTP 5xx** | Server error; use cached config | Yes (backoff) |
| **Signature invalid** | REJECT config; use cached; log alert | Yes (backoff) |
| **Hash mismatch** | REJECT config; use cached; log alert | Yes (backoff) |
| **Config expired** | REJECT config; use cached; log alert | Yes (backoff) |
| **Key revoked** | REJECT config; use cached; log alert | Yes (backoff) |
| **Parse error** | REJECT config; use cached | Yes (backoff) |

### Security Alerts

The following errors indicate potential security issues and SHOULD be logged with high priority:

- KeyList root signature verification failure
- Manifest signature verification failure
- Content hash mismatch
- Content size mismatch
- Key not found in KeyList (possible key injection attempt)
- KeyList sequence going backwards (possible replay attack)

**DO NOT** expose signature verification failure details to the UI. Log them for developers, but show generic messages to users.

---

## Security Checklist

### Hardcoded Trust Anchor

- [ ] Root public key is compiled into the binary (not fetched from a server)
- [ ] Root public key is stored as raw bytes or base64 constant (not in a config file that could be modified)

### Signature Verification

- [ ] Canonical JSON implementation matches the server exactly (test with known inputs)
- [ ] KeyList root signature is verified before trusting any keys
- [ ] Manifest signature is verified before applying any config
- [ ] Content hash is verified after downloading config
- [ ] Content size is verified after downloading config

### Key Management

- [ ] Only keys with `status: "active"` are used for verification
- [ ] Key validity window (`not_before`, `not_after`) is checked against current time
- [ ] KeyList `list_sequence` only advances forward (replay protection)
- [ ] KeyList `expires_at` is checked

### Expiry Checks

- [ ] Manifest `expires_at` is checked before applying config
- [ ] KeyList `expires_at` is checked before trusting keys
- [ ] Expired configs are rejected even if signature is valid

### Transport Security

- [ ] All API calls use HTTPS (TLS 1.2+)
- [ ] Certificate pinning is recommended for high-security deployments
- [ ] Server URL is hardcoded or loaded from a secure configuration

### State Protection

- [ ] Persisted state file is stored in app-private storage (not world-readable)
- [ ] State file corruption results in safe fallback to defaults
- [ ] No sensitive data (private keys, tokens) is stored in state

### Version Monotonicity

- [ ] Config version must strictly increase; never accept an older version
- [ ] KeyList sequence must not decrease; reject replayed key lists

---

## Testing Guide

### Canonical JSON Test Vectors

Use these test cases to verify your canonical JSON implementation produces identical output:

```
Input:  {"b":2,"a":1}
Output: {"a":1,"b":2}

Input:  {"z":{"b":2,"a":1},"a":0}
Output: {"a":0,"z":{"a":1,"b":2}}

Input:  [3,1,2]
Output: [3,1,2]          (arrays preserve order)

Input:  {"a":true,"b":false,"c":null}
Output: {"a":true,"b":false,"c":null}

Input:  {"a":"hello\"world"}
Output: {"a":"hello\"world"}

Input:  {"a":1.0}
Output: {"a":1}           (integer representation for whole numbers)

Input:  {}
Output: {}

Input:  []
Output: []
```

### Integration Test Scenario

1. **Generate test keys**: Create a root key pair and signing key pair (ed25519)
2. **Build a KeyList**: Include the signing key, sign with root private key
3. **Build a Config**: Create a sample config object
4. **Build a Manifest**: Compute content_hash and content_size, sign with signing key
5. **Verify on client**: Feed the KeyList + Manifest + Config through the client verification pipeline
6. **Verify rejection**: Tamper with one byte of the config and confirm rejection

### Tamper Detection Tests

Verify that the client rejects:

- [ ] Config with modified `content` field (hash mismatch)
- [ ] Manifest with modified `version` field (signature mismatch)
- [ ] KeyList with modified `keys` array (root signature mismatch)
- [ ] Manifest signed with revoked key (key status check)
- [ ] Manifest with `expires_at` in the past (expiry check)
- [ ] KeyList with `list_sequence` less than cached (replay protection)
- [ ] Config where `content_size` doesn't match (size check)

### Clock Skew Considerations

The system uses Unix timestamps. Consider adding a small tolerance (e.g., 60 seconds) for clock skew between client and server, particularly for mobile devices that may have slightly inaccurate clocks. Apply tolerance only to `expires_at` checks, never to `not_before`.

---

## Appendix: Base64 Encoding

All binary data (public keys, signatures) uses **standard Base64 encoding** (RFC 4648, with `+` and `/`, padding with `=`).

| Data | Encoded Size |
|------|-------------|
| Ed25519 public key (32 bytes) | 44 characters |
| Ed25519 signature (64 bytes) | 88 characters |

**Decoding:**

```
// Swift
let data = Data(base64Encoded: base64String)!

// Kotlin
val bytes = Base64.getDecoder().decode(base64String)

// Dart
final bytes = base64Decode(base64String);
```
