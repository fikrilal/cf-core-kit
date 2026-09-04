# Request Validation (task 1.4)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-10
- Related ADRs / proposals: ADR-0002 (dialect), ADR-0003 (zod schemas), ADR-0008 (typed codes); roadmap task 1.4

## Objective

Zod-powered request validation that renders family-shaped validation problems: `errors[] { field?, message }` under `VALIDATION_FAILED` with the "Validation Failed" title. Two helpers: `decode` (pure, schema + parsed input) and `readJson` (Hono request body). `AppError` learns optional `issues`, and the problem mapper renders `errors[]`.

## Constraints

- Shape parity (verified against backend sources): `ProblemException(400, { title: 'Validation Failed', code: VALIDATION_FAILED, errors: flattenValidationErrors(...) })` — **no `detail`** on validation problems.
- `errors[]` is omitted entirely when there are no issues (backend conditional-spread behavior).
- Malformed JSON body maps to the same `400 / VALIDATION_FAILED` problem without issues (backend: Fastify 400 → `defaultProblemCode(400) = VALIDATION_FAILED`).
- Issue mapping: `field` = dot-joined zod path, omitted for root-level issues; `message` = zod message.
- `AppError.message` becomes optional (defaults to empty) so validation problems can omit detail while other errors keep theirs.
- No custom zod message copy yet — defaults hold until a copy standard exists.
- Strict lint budgets (ADR-0011); no comments.

## Impact Areas

- API / contract: yes (`errors[]` shape and `VALIDATION_FAILED` rendering)
- DB / migrations: no
- Auth / session: no
- Queue / jobs: no
- Config / secrets: no
- Observability: no
- Budget / free-tier footprint: no
- CI / release: no

## Acceptance Criteria

1. `decode` returns typed data for valid input; throws `AppError` (400, `VALIDATION_FAILED`) with per-field `issues` otherwise.
2. Validation problems carry `errors[]` with `{ field?, message }` and no `detail`; the key is absent when there are no issues.
3. `readJson` covers valid bodies, schema-invalid bodies, and malformed JSON.
4. Tests green; `npm run verify` green; roadmap 1.4 checked; plan filed to `completed/`.

## Steps

- [x] Extend `AppError` (optional `message`, `issues[]`) + problem mapper (`errors[]`)
- [x] `src/platform/http/validation.ts` (`decode`, `readJson`)
- [x] Tests: validation spec, app integration routes, error/problem spec additions
- [x] Verify + roadmap/bookkeeping

## Decision Log

- 2026-10-10: `AppError.message` becomes optional so validation problems render without `detail` (backend parity). -> clients never relied on a validation detail; errors[] is the payload
- 2026-10-10: omit `errors[]` when empty instead of rendering `[]`. -> matches backend's conditional spread exactly
- 2026-10-10: zod default messages kept as `message` values. -> copy ownership stays at the edge; no standard exists yet
- 2026-10-10: `readJson` maps malformed JSON to 400 `VALIDATION_FAILED` without issues. -> mirrors backend's Fastify-400 default mapping

## Verification

Exact commands and outcomes:

```bash
npm run verify
# format:check ✓, lint ✓, typecheck ✓
# tests: 48 passed across 10 files (8 added: validation 3, app 3, app-error 1, problem 1)
# build: wrangler dry-run — 828.99 KiB / gzip 134.94 KiB; bindings APP_ENV, LOG_LEVEL
```

## Completion Notes

Request validation landed: `decode` (zod schema + input → typed data, or `AppError` 400 `VALIDATION_FAILED` with per-field issues) and `readJson` (request body; malformed JSON → the same problem without issues). `AppError` gained optional `message` and `issues[]`; the problem mapper renders `errors[] { field?, message }` — omitted when empty, and validation problems carry no `detail` (backend parity). 8 new tests; 48 total green; verify green end to end.

## Follow-ups

- [ ] List-query validation reuses the same issue shape in task 1.5
- [ ] Validation `errors[]` asserted in the Phase 2 contract suite
