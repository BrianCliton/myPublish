# Changelog

## 2026-03-21 [phase-5] Tests and Documentation

- Created comprehensive E2E test (`test/e2e/full-flow.test.ts`) covering the full publish-subscribe lifecycle: key generation, server startup, user/key seeding, key list publishing, config publishing, client fetch/verify, config update detection, key revocation, and revoked key rejection
- Added AdminStore unit tests (`test/server/admin-store.test.ts`) covering all CRUD operations for users, configs, approvals, signing keys, and key lists
- Added service layer tests (`test/server/services.test.ts`) for approval workflow, key management (generate, revoke, encrypt/decrypt, publish key list), and publisher service
- Added middleware tests (`test/server/middleware.test.ts`) for JWT auth, login route, and RBAC role hierarchy
- Fixed poller manifest parsing bug: server returns `{ manifest: {...} }` but poller was parsing the raw response as Manifest
- Fixed server error handler to properly handle `HTTPException` from `hono/jwt` middleware (was returning 500 instead of 401 for auth errors)
- Updated architecture documentation with complete system overview
- **Test results:** 233 tests passing, 96.28% line coverage

## 2026-03-21 [phase-1-4] Core Implementation

- Initialized PMA project management system
- Implemented core module: ed25519 signing, canonical JSON, SHA-256 hashing, key list validation, full validation pipeline
- Implemented server: public API (keys, config endpoints with ETag), admin API (users, configs, keys), JWT auth, RBAC, approval workflow, publisher service, key manager
- Implemented client library: PublishClient, Poller with exponential backoff, KeyRing, state persistence
- Database schema: users, signing_keys, key_lists, configs, approvals
