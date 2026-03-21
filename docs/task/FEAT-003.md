# FEAT-003 Implement server public API (DB schema, /v1/keys, /v1/config)

- **status**: review
- **priority**: P0
- **owner**: agent
- **createdAt**: 2026-03-21 12:29
- **bkd_issue**: r63ekq3c (#4)

## Description

Phase 2 of PLAN-001. DB schema, data access layer, public API routes.

## Dependencies

- **blocked by**: FEAT-002
- **blocks**: FEAT-004

## Implementation

### Files Created

- `src/server/db/schema.ts` — SQL schema (users, signing_keys, key_lists, configs, approvals)
- `src/server/db/migrations/001_init.ts` — Migration runner
- `src/server/db/store.ts` — Data access layer (Store class)
- `src/server/routes/public.ts` — Public API routes (Hono router)
- `src/server/index.ts` — Server entry point (createApp, startServer)
- `test/server/public.test.ts` — 28 tests covering all endpoints + store layer

### Public API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /v1/keys` | Latest KeyList (root-signed) |
| `GET /v1/config/latest` | Latest published manifest + config, ETag/304 support |
| `GET /v1/config/latest/manifest` | Manifest only (lightweight version check), ETag/304 |
| `GET /v1/config/:version` | Specific published version |

### Test Results

- 28 new tests, all passing
- 84 total tests (56 core + 28 server)

## Notes

See PLAN-001 sections 7 (API) and 11 (DB Schema).
