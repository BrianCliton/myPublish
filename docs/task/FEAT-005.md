# FEAT-005 Implement client library (poller, keyring, state)

- **status**: review
- **priority**: P0
- **owner**: agent
- **createdAt**: 2026-03-21 12:29
- **bkd_issue**: exkovsg8 (#6)

## Description

Phase 4 of PLAN-001. Client library with polling, key ring, state persistence.

## Dependencies

- **blocked by**: FEAT-002
- **blocks**: FEAT-006

## Implementation

### Files Created

- `src/client/state.ts` — State persistence (load/save JSON, corruption recovery)
- `src/client/keyring.ts` — KeyRing class (trusted key management, replay protection)
- `src/client/poller.ts` — Poller class (exponential backoff, jitter, two-step poll)
- `src/client/index.ts` — PublishClient (main API, lifecycle, state restoration)

### Tests Created

- `test/client/state.test.ts` — 10 tests (roundtrip, corruption, partial state)
- `test/client/keyring.test.ts` — 13 tests (trust, revocation, replay, expiry)
- `test/client/poller.test.ts` — 10 tests (fetch, verify, backoff, key list update)
- `test/client/index.test.ts` — 8 tests (integration, persistence, error handling)

### Coverage

Client module: 100% functions, 99%+ lines across all 4 files.
All 115 tests pass (74 core + 41 client).

## Notes

See PLAN-001 section 8 (client verification flow).
