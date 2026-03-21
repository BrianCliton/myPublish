# Architecture

> Updated: 2026-03-21

## Overview

PMA Publish is a secure configuration distribution system that uses ed25519 digital signatures to ensure integrity and authenticity of application configurations. It implements a publish-subscribe model where a server publishes signed configurations and clients verify them before applying.

## Tech Stack

- **Runtime:** Bun (TypeScript)
- **Web Framework:** Hono
- **Database:** SQLite (via `bun:sqlite`)
- **Cryptography:** @noble/ed25519 (audited ed25519 implementation)
- **Validation:** Zod (schema validation + type inference)
- **Auth:** JWT (via `hono/jwt`)
- **Testing:** `bun:test`

## Directory Structure

```text
src/
├── core/                         # Shared crypto + validation logic
│   ├── types.ts                  # Zod schemas & TypeScript types
│   ├── signing.ts                # ed25519 sign/verify, key generation
│   ├── canonical.ts              # Deterministic JSON serialization
│   ├── hash.ts                   # SHA-256 content hashing
│   ├── keylist.ts                # Key list validation & lookup
│   ├── validation.ts             # Full manifest+config validation pipeline
│   └── index.ts                  # Public re-exports
├── server/
│   ├── index.ts                  # App creation & Bun server lifecycle
│   ├── routes/
│   │   ├── public.ts             # GET /v1/keys, /v1/config/*
│   │   └── admin/                # Admin API routes
│   │       ├── users.ts          # User CRUD (admin only)
│   │       ├── configs.ts        # Config lifecycle (draft→publish)
│   │       └── keys.ts           # Signing key management
│   ├── middleware/
│   │   ├── auth.ts               # JWT authentication + login
│   │   └── rbac.ts               # Role-based access control
│   ├── services/
│   │   ├── approval.ts           # Submit/approve/reject workflow
│   │   ├── publisher.ts          # Config signing & publishing
│   │   └── keymanager.ts         # Key generation, encryption, revocation
│   └── db/
│       ├── schema.ts             # SQL table definitions
│       ├── store.ts              # Public data access layer
│       ├── admin-store.ts        # Admin data access layer (extends Store)
│       └── migrations/
│           └── 001_init.ts       # Initial schema migration
└── client/
    ├── index.ts                  # PublishClient main class
    ├── poller.ts                 # Polling with exponential backoff
    ├── keyring.ts                # Trusted key management
    └── state.ts                  # Client state persistence

test/
├── core/                         # Unit tests for core module
├── server/                       # Server API & service tests
├── client/                       # Client library tests
└── e2e/                          # End-to-end integration tests
```

## Two-Layer Key System

```
Root Key (offline, never rotated)
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

- **Root Key:** Kept offline. Only used to sign KeyLists. Compromise requires client-side update.
- **Signing Keys:** Online keys stored encrypted in the database. Sign config manifests. Can be rotated and revoked via KeyList updates without client changes.

## Manifest + Config Model

Each published configuration consists of two parts:

| Component | Purpose |
|-----------|---------|
| **Manifest** | Signed metadata: `version`, `content_hash`, `content_size`, `key_id`, `timestamp`, `expires_at`, `signature` |
| **Config** | Business content: `update`, `endpoints`, `features`, `announcements`, `custom` |

Separation allows the config schema to evolve without breaking the signature verification pipeline.

## API Overview

### Public API (no auth required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/keys` | GET | Latest root-signed key list |
| `/v1/config/latest` | GET | Latest published config + manifest (supports ETag/304) |
| `/v1/config/latest/manifest` | GET | Manifest only (lightweight version check) |
| `/v1/config/:version` | GET | Specific published version |

### Admin API (JWT auth required)

| Endpoint | Method | Role | Description |
|----------|--------|------|-------------|
| `/v1/admin/auth/login` | POST | any | Authenticate and get JWT |
| `/v1/admin/users` | GET/POST | admin | User management |
| `/v1/admin/configs` | GET/POST | publisher+ | Config CRUD |
| `/v1/admin/configs/:v/submit` | POST | publisher+ | Submit draft for review |
| `/v1/admin/configs/:v/approve` | POST | reviewer+ | Approve config |
| `/v1/admin/configs/:v/reject` | POST | reviewer+ | Reject config |
| `/v1/admin/configs/:v/publish` | POST | publisher+ | Sign and publish approved config |
| `/v1/admin/keys` | GET/POST | admin | Signing key management |
| `/v1/admin/keys/:id/revoke` | POST | admin | Revoke a signing key |
| `/v1/admin/keys/publish-list` | POST | admin | Publish new root-signed key list |

### Role Hierarchy

`admin` > `publisher` > `reviewer` — each role includes all permissions of lower roles.

## Config Lifecycle

```
draft → pending_review → approved → published
                 ↓
              rejected
```

Requires 2 reviewer approvals (configurable via `MIN_APPROVALS` env). Authors cannot approve their own configs.

## Client Verification Flow

1. Fetch KeyList from `/v1/keys` → verify root signature
2. Check `/v1/config/latest/manifest` for version change (lightweight)
3. If new version, fetch full config from `/v1/config/latest`
4. Verify KeyList root signature is valid
5. Verify signing key is active and within validity window
6. Verify manifest signature with signing key's public key
7. Verify `content_hash` matches SHA-256 of canonical JSON config
8. Verify `content_size` matches byte length
9. Check manifest has not expired
10. Apply config and cache state

Polling uses exponential backoff with ±10% jitter on errors, capped at 24 hours.
