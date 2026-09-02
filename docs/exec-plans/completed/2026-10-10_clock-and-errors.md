# Clock and Error Platform (task 1.2)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-10
- Related ADRs / proposals: ADR-0008 (clock injection, typed codes), ADR-0002 (error codes are contract); roadmap task 1.2

## Objective

Platform primitives every later task consumes: an injectable `Clock` (no wall-clock reads in service/domain code) and typed application errors — the family `ErrorCode` enum, the growing `AppErrorCode` union, and an `AppError` class carrying `status` / `code` / `message` / `retryAfterSeconds` for the problem mapper that lands in task 1.3.

## Constraints

- Error codes are contract surface: values must match the backend-core-kit dialect exactly (verified against `libs/shared/error-codes.ts`).
- No raw production error-code strings — codes are typed through `AppErrorCode`.
- `Clock` is the only sanctioned `Date.now()` / `new Date()` site outside composition roots.
- No speculative API: constructor-only `AppError`, no convenience statics until first usage.
- Strict lint budgets (ADR-0011).

## Impact Areas

- API / contract: yes (error-code values are contract)
- DB / migrations: no
- Auth / session: no
- Queue / jobs: no
- Config / secrets: no
- Observability: no
- Budget / free-tier footprint: no
- CI / release: no

## Acceptance Criteria

1. `ErrorCode` carries exactly the eight family codes; `AppErrorCode` is the union features extend later.
2. `AppError` carries `status`, typed `code`, `message`, optional `retryAfterSeconds`; `instanceof Error` works.
3. `systemClock` returns the current time; `fixedClock` returns defensive copies of a fixed instant.
4. Tests green; `npm run verify` green; roadmap 1.2 checked; plan filed to `completed/`.

## Steps

- [x] `src/shared/error-codes.ts` (enum + union) + dialect tripwire test
- [x] `src/platform/errors/app-error.ts` + tests
- [x] `src/platform/clock/clock.ts` + tests
- [x] Verify + roadmap/bookkeeping

## Decision Log

- 2026-10-10: mirror the backend `ErrorCode` enum verbatim (eight codes, same values). -> error codes are contract; drift fails downstream clients
- 2026-10-10: `AppErrorCode` starts as an alias of `ErrorCode`; feature enums union in as they land. -> same shape as backend's `app-error-codes.ts`
- 2026-10-10: constructor-only `AppError`. -> no speculative API; statics land with first real usage
- 2026-10-10: dialect tripwire test pins code values until the Phase 2 contract suite owns them. -> no snapshot exists yet

## Verification

Exact commands and outcomes:

```bash
npm run verify
# format:check ✓, lint ✓, typecheck ✓
# tests: 15 passed (config 8, clock 2, app-error 2, error-codes 1, worker 2)
# build: wrangler dry-run — 767.57 KiB / gzip 119.67 KiB
```

## Completion Notes

Clock and error platform landed: `src/platform/clock` (`systemClock`, `fixedClock` with defensive copies), `src/platform/errors` (`AppError` carrying typed `code`, `status`, optional `retryAfterSeconds`), `src/shared/error-codes` (the eight family codes verbatim + `AppErrorCode` union). 5 new tests; 15 total green; `npm run verify` green end to end.

## Follow-ups

- [ ] Problem mapper consumes `AppError` in task 1.3
- [ ] `no-restricted-syntax` ban for `Date.now()` outside clock/platform adapters lands with feature-level enforcement (3.5)
- [ ] Feature error-code files join `src/shared/<feature>/` as features land
