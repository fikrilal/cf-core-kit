# Contract suite: dialect invariants on live responses (task 2.4)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0002 (mechanism 4: contract tests assert dialect invariants on live responses), ADR-0003 (platform helpers own rendering); roadmap task 2.4

## Objective

A dedicated `test/contract/` suite asserts the family dialect on responses produced by the composed app running in the Workers pool (real middleware pipeline, not unit-level calls): envelope `{ data }` / list `{ data, meta: { limit, hasMore, nextCursor? } }`, RFC7807 problem details with stable `code` and `traceId` (= `X-Request-Id`), `X-Request-Id` echo semantics (valid echoed, invalid/absent replaced with a UUID), 204 with an empty body and no content-type, 201 semantics, and validation-failure shape (`errors[]` with per-field entries, no `detail`).

## Constraints

- The suite lives in `test/contract/` (the map's "integration and contract suites"); Vitest's include widens to `["src/**/*.spec.ts", "test/**/*.spec.ts"]` (scripts/tools stay excluded).
- Real routes exist only for `/health`, `/ready`, and the scaffold root today; the dialect invariants that need richer routes (list envelope, 204, 201, idempotent replay) mount minimal **fixture routes** on the composed app inside the test — the platform guarantees under test are the envelope/problem/logging modules, not feature behavior. Fixture routes use the platform helpers (`data`, `list`, `created`, `noContent`, `readJson`, `decode`), never hand-built responses.
- Assertions are dialect-level: content types (`application/json` vs `application/problem+json`), header presence/echo, `traceId` equality with the response `X-Request-Id`, `about:blank` type, absence of `detail` on generic 500s, `meta` key naming (`limit`, `hasMore`, `nextCursor`).
- Overlap with existing unit specs is accepted: unit specs pin module behavior; the contract suite is the named dialect certificate and the extension point for every future feature (Phase 3 adds auth sessions, lists, idempotent writes here).
- No new runtime code expected; if a gap is found (e.g. a helper emitting a wrong content-type), fixing it is in scope.
- Gate honesty: the suite itself must fail when an invariant is broken — verified by at least one deliberate mutation probe (e.g. temporarily change the problem content-type assertion target or inject a bad helper call), then reverted.

## Impact Areas

- API / contract: yes (the dialect certificate)
- Budget / free-tier footprint: no
- CI / release: yes (runs inside the existing vitest step)
- Docs: yes (test/ layout note in AGENTS map only if file paths change)

## Acceptance Criteria

1. `test/contract/dialect.spec.ts` (plus fixtures as needed) covers: success envelope, list envelope with meta, 201 created, 204 empty, 400 validation shape, 404 `NOT_FOUND` problem, unknown-error 500 without `detail`, `X-Request-Id` echo (valid/invalid/absent), `traceId` = `X-Request-Id` on problems.
2. Suite runs in the Workers pool via the widened include; total suite green; `npm run verify` green.
3. At least one live mutation probe demonstrates the suite fails on a broken invariant (recorded, then reverted).
4. Roadmap 2.4 checked; plan filed to `completed/`.

## Steps

- [x] Widen the Vitest include; scaffold `test/contract/` with the composed-app fixture harness
- [x] Write the invariant specs (envelope, created, 204, problems, request-id, validation)
- [x] Mutation probe + verify + bookkeeping

## Decision Log

- 2026-10-11: fixture routes live inside the suite; no production stub routes are added. -> dialect tests exercise platform helpers on a real pipeline without shipping fake endpoints
- 2026-10-11: include widens to `test/**` rather than relocating the suite under `src/`. -> the map already designates `test/` for contract suites; tooling follows the layout

## Verification

Exact commands and outcomes:

```bash
npm run verify          # fast profile green
npx vitest run test/contract/dialect.spec.ts   # 13 passed
npm run test            # 160 tests across 27 files (was 147/26)
# mutation probe: envelope.noContent 204 -> 200 -> the 204 invariant test fails
#   (1 failed | 12 passed); restored -> 13 passed
npm run verify:ci       # full profile green (11 steps)
```

## Completion Notes

`test/contract/dialect.spec.ts` certifies the family dialect on responses from the composed app in the Workers pool: success envelopes (`{ data }`, list meta with exactly `limit`/`hasMore` plus `nextCursor` when present, 201 + Location, 204 empty with no content-type), problems (409 with `Retry-After` and `traceId` equal to the response `X-Request-Id`, generic 500 without `detail`, 404 `NOT_FOUND`), validation shape (per-field `errors[]`, no `detail`), request-id semantics (valid echoed, invalid replaced with a UUID, absent generated), and the health surface. Fixture routes mount platform helpers on the composed app inside the suite — no production stubs. Vitest include widened to `test/**/*.spec.ts`; one lint fix (`expect.any` matcher typed through an `unknown` local). Mutation probe (breaking `noContent`) failed exactly the 204 test and was restored.

## Follow-ups

- [ ] Phase 3 extends the suite with session/token and idempotent-write invariants
