# List Query Platform (task 1.5)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-10
- Related ADRs / proposals: ADR-0002 (dialect), ADR-0003 (Hono pipeline), ADR-0008 (typed codes); roadmap task 1.5

## Objective

The family's list-query dialect, framework-free: cursor codec (v1, base64url JSON), sort parsing (comma-separated, `-` prefix, allowlist, max 3 fields, tie-breaker), filter parsing (`filter[field]` eq, `[in]`, `[gte]`, `[lte]` with per-endpoint allowlists), `q` search gate, and `limit` (default 25, max endpoint-defined) — plus the Hono adapter that reads bracket-style query params and maps validation failures to `VALIDATION_FAILED` problems. Semantics and error messages are ported from backend-core-kit's `libs/shared/list-query` (dialect parity); the HTTP adapter mirrors the pipe behavior.

## Constraints

- Parity: port semantics, messages, and the test matrix from the backend sources (dialect the client tooling depends on).
- Workers adaptation: cursor base64url uses `TextEncoder` + `btoa`/`atob` (no `Buffer`).
- `new Date(string)` inside scalars is value parsing only — never a clock read (the Clock rule targets `Date.now()`/current-time reads).
- Hono adapter input shape: `context.req.queries()` flat keys mapped to qs-style nesting (`filter[a]`, `filter[a][op]`); repeated values are passed as arrays so the parser rejects them exactly like Fastify qs does.
- Generic where-building algebra (`buildCursorAfterWhere`, `createCursorAfterBuilders`, `mergeWhereClauses`) is **deferred to task 1.6** — no repository consumer exists yet; it lands with the Drizzle field ops.
- Strict lint budgets; no comments.

## Impact Areas

- API / contract: yes (query parameters, `errors[]` fields, meta semantics)
- DB / migrations: no (query building lands in 1.6)
- Auth / session: no
- Queue / jobs: no
- Config / secrets: no
- Observability: no
- Budget / free-tier footprint: no
- CI / release: no

## Acceptance Criteria

1. `parseListQuery` mirrors backend behavior: limit bounds, sort normalization + tie-breaker, filter allowlists/operators, `q` gating, cursor decode bound to the normalized sort, accumulated issues on one `ListQueryValidationError`.
2. `encodeCursorV1`/`decodeCursorV1` round-trip; reject version, sort mismatch, missing/unsupported/invalid `after` fields, bad encoding/JSON, and >4096-char cursors.
3. `readListQuery` parses bracket query strings and maps failures to 400 `VALIDATION_FAILED` with `errors[] { field, message }`.
4. Ported tests green; `npm run verify` green; roadmap 1.5 checked; plan filed to `completed/`.

## Steps

- [x] Port `src/shared/list-query` (types, errors, object, scalars, cursor, sort, filter, list-query, barrel)
- [x] `src/platform/http/list-query.ts` (`readListQuery`)
- [x] Port test matrix + adapter/app integration specs
- [x] Verify + roadmap/bookkeeping

## Decision Log

- 2026-10-10: port semantics, messages, and test cases verbatim from the backend shared module. -> dialect parity is the point of this task
- 2026-10-10: base64url via `TextEncoder`/`btoa`/`atob`. -> Workers has no `Buffer`; output format unchanged
- 2026-10-10: defer the where-clause algebra to 1.6. -> no consumer yet; it needs Drizzle field ops to be real
- 2026-10-10: repeated query values pass through as arrays. -> mirrors Fastify qs nesting so the parser rejects them identically
- 2026-10-10: port normalized to this repo's lint baseline (`readonly T[]` over `ReadonlyArray`, no redundant `String()`), decoder split into header/after helpers under the complexity budget. -> behavior unchanged; style and budgets are ours
- 2026-10-10: parity pass on request — where-algebra deferral reversed and adapter strictness (unknown query params) aligned with the backend DTO. -> backend-equal quality/behavior is the bar

## Verification

Exact commands and outcomes:

```bash
npm run verify
# format:check ✓, lint ✓, typecheck ✓
# tests: 98 passed across 17 files (50 added: cursor 7, sort 7, filter 9, list-query 6, cursor-after 5, where 6, http adapter 10)
# build: wrangler dry-run — 828.99 KiB / gzip 134.94 KiB; bindings APP_ENV, LOG_LEVEL
```

## Completion Notes

List-query platform landed: framework-free `src/shared/list-query` (cursor v1 codec on `TextEncoder`/`btoa`/`atob`, scalar/sort/filter parsers with per-endpoint allowlists, `parseListQuery` with limit bounds, `q` gating, and accumulated issues) plus the Hono adapter `readListQuery` (bracket query mapping; `ListQueryValidationError` → 400 `VALIDATION_FAILED` with `errors[]`). Semantics, messages, and the test matrix were ported from backend-core-kit. 35 new tests; 83 total green; verify green end to end. Post-completion same-day backend parity pass: `cursor-after.ts` / `where.ts` (+ specs) ported — the deferral is reversed; the Hono adapter now rejects unknown query parameters and non-object `filter` values (mirroring the backend DTO's `forbidNonWhitelisted`), and `maxLimit > 250` is covered. Spec parity vs backend: cursor 7/7, sort 7/7, filter 9/9, list-query 6/6, cursor-after 5/4, where 6/0, http adapter 10/2.

## Follow-ups

- [x] `cursor-after` / `where` algebra ported in the parity pass; Drizzle field ops wire up in task 1.6
- [ ] List-query behavior asserted in the Phase 2 contract suite
- [ ] OpenAPI list params (`@ApiListQuery` analog) land with the contract pipeline
