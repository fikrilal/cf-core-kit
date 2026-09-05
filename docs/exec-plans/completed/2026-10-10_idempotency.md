# Idempotency (task 1.7)

- Status: completed
- Owner: fikrilal
- Risk: high
- Date: 2026-10-10
- Related ADRs / proposals: ADR-0004 (D1 records, batch semantics), ADR-0007 (no KV for state), ADR-0002 (contract behavior); backend `docs/standards/reliability.md`; roadmap task 1.7

## Objective

D1-backed API idempotency that mirrors backend-core-kit semantics: `Idempotency-Key` support on write routes with acquire / replay / in-progress-wait states, request-hash mismatch rejection, `Idempotency-Replayed: true` on replays (201 downgraded to 200), `409 IDEMPOTENCY_IN_PROGRESS` + `Retry-After: 1` while a lock is held, error responses never cached, oversized replay records failing safe, TTLs with stale-lock takeover, and a sweep helper for the future cron. This task also brings the first real table and therefore the first generated migration and the migrations pipeline E2E in tests.

## Constraints

- Semantics, bounds, and messages ported from the backend (`idempotency.core.ts`, `idempotency.service.ts`, `idempotency.interceptor.ts`).
- D1 replaces Redis: atomic acquire via `INSERT … ON CONFLICT(key) DO NOTHING` (changes meta decides the winner); no auto-expiry, so `expires_at` + stale-lock takeover + sweep replace Redis TTL/eviction.
- Hashing via WebCrypto (async SHA-256, base64url) with the backend's bounds: depth 5, 100 array items, 100 object keys, 1024 chars/string, 32768 chars total. No `Buffer` branch — bodies are JSON; uploads/streams are out of scope per the reliability standard.
- The request body is read from `request.clone()` so handlers still consume it; unparseable bodies hash as `undefined`.
- Principal scoping: `principalId` context variable (auth middleware sets it in Phase 3); missing → the backend's 500 wiring error.
- Effects ordering: the middleware registers before handler execution in the fixed pipeline; `AppError.retryAfterSeconds` renders `Retry-After` via the existing problem mapper.
- Strict lint budgets (ADR-0011); no comments.

## Impact Areas

- API / contract: yes (idempotency headers, 409 codes, replay semantics)
- DB / migrations: yes (first table + first migration; pipeline E2E)
- Auth / session: no (principal variable consumed, not implemented)
- Queue / jobs: no (sweep helper only; cron wiring in Phase 4)
- Config / secrets: no
- Observability: no
- Budget / free-tier footprint: yes (1–2 row writes per idempotent request; bounded replay records)
- CI / release: no

## Acceptance Criteria

1. `idempotent()` middleware on write routes: skip / required-header 400 / hash-mismatch 409 / replay / in-progress 409 with `Retry-After: 1` / 500 for missing principal and non-write routes — all matching backend behaviors.
2. Replays return the stored body with `Idempotency-Replayed: true`, `Location` preserved, and 201 downgraded to 200; error responses are never cached (row released, retry re-executes).
3. TTL semantics: stale in-progress rows are taken over, completed rows expire with `ttlSeconds`, and the sweep deletes expired rows only.
4. Oversized serialized records (> 65536 chars) fail safe (released, not cached).
5. First migration generated from the schema, applied locally, and applied in tests via `applyD1Migrations`; a test asserts the migrated table exists.
6. Tests green; `npm run verify` green; roadmap 1.7 checked; plan filed to `completed/`.

## Steps

- [x] Schema: `idempotency_records` + first migration (generate, local apply)
- [x] `idempotency.core.ts` (records, bounds, stable stringify, async hashes) + unit tests
- [x] `idempotency.service.ts` (begin / wait / complete / release / sweep on D1)
- [x] `idempotency.ts` middleware + `principalId` context variable
- [x] Vitest migrations setup (`readD1Migrations` + `applyD1Migrations`) + integration tests
- [x] Verify + roadmap/bookkeeping

## Decision Log

- 2026-10-10: D1 unique-key row replaces Redis: `INSERT … ON CONFLICT DO NOTHING` + `meta.changes` decides acquire; `expires_at` column carries both lock TTL and replay TTL. -> ADR-0004/0007; no KV
- 2026-10-10: stale in-progress rows are taken over after `expires_at` (delete-with-match then one retry, else 409). -> replaces Redis key eviction; mirrors the backend's one-retry race handling
- 2026-10-10: request hash via WebCrypto (async); Buffer branch dropped. -> Workers has no Buffer; JSON bodies only
- 2026-10-10: body hashed from `request.clone()`; unparseable bodies hash as `undefined`. -> handlers keep their stream; hash determinism preserved per request shape
- 2026-10-10: response body cached by cloning the produced response; non-JSON bodies cache as bodiless. -> mirrors the backend storing the handler's return value
- 2026-10-10: `IDEMPOTENCY_IN_PROGRESS` carries `retryAfterSeconds: 1`. -> problem mapper renders the interceptor's `Retry-After: 1`
- 2026-10-10: binding-dependent middleware tests pass the runtime env into `app.request` explicitly. -> Hono's test helper does not carry `env` by default (found by failing tests; mirrors the worker spec pattern)

## Verification

Exact commands and outcomes:

```bash
npm run verify
# format:check ✓, lint ✓, typecheck ✓
# tests: 121 passed across 20 files (19 added: core 6, middleware + D1 integration 13)
# build: wrangler dry-run — 828.99 KiB / gzip 134.94 KiB; bindings DB, APP_ENV, LOG_LEVEL

npx drizzle-kit generate                              # 0000_futuristic_colossus.sql (idempotency_records)
npx wrangler d1 migrations apply cf-core-kit --local  # applied locally
```

## Completion Notes

Idempotency landed: `idempotent()` middleware (write-method gate; header required/too-long 400s; principal 500; key `idempotency:v1:{principalId}:{sha256(scopeKey)}:{header}`) over the D1-backed service (`INSERT … ON CONFLICT DO NOTHING` acquire; stale-lock takeover; wait/backoff; release on error; oversized records fail safe; sweep helper). Core ports the backend record schema, hash bounds, and messages; hashing is WebCrypto SHA-256 base64url. The first migration (`idempotency_records`) was generated, applied locally, and is applied in tests via `applyD1Migrations`. Replays downgrade 201→200, set `Idempotency-Replayed: true`, and preserve `Location`; in-progress yields 409 + `Retry-After: 1`; reuse with a different payload yields 409 CONFLICT. 19 new tests; 121 total green.

## Follow-ups

- [ ] Sweep wiring into the fan-out cron (Phase 4) and the free-tier budget standard
- [ ] Auth middleware sets `principalId` (Phase 3); idempotent routes require it
- [ ] Idempotency behaviors asserted in the Phase 2 contract suite
- [ ] Retention note: table grows for `ttlSeconds` windows; sweep cadence documented with 4.2
