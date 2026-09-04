# HTTP Foundation (task 1.3)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-10
- Related ADRs / proposals: ADR-0002 (dialect), ADR-0003 (Hono pipeline), ADR-0008 (typed errors); roadmap task 1.3

## Objective

The Hono request pipeline every route rides on: the app factory with the fixed middleware order (request-id now; logging and auth slots land in 1.8 and Phase 3), request-id acceptance/generation/echo per the family rules, envelope helpers (`data` / `list` / `created` / `noContent`), and the central problem mapper that renders `AppError` (and unexpected failures) as RFC7807 `application/problem+json`. The worker is wired through the app.

## Constraints

- Dialect parity (verified against backend-core-kit sources this session):
  - Request id: non-empty, ≤ 128 chars, `^[A-Za-z0-9._-]+$`; otherwise a fresh UUID is generated; echoed as `X-Request-Id` and mirrored as `traceId` in problems.
  - Problem body: `type` (`"about:blank"` default), `title`, `status`, optional `detail`, `code`, optional `traceId`; `Content-Type: application/problem+json`; `Retry-After` when `retryAfterSeconds` is present.
  - Titles: `VALIDATION_FAILED` → "Validation Failed"; otherwise the status title map with the >= 500 fallback "Internal Server Error" (same map values as backend).
- Unexpected errors map to 500 `INTERNAL` with **no detail** (no leakage); they are not logged until task 1.8 (noted as follow-up).
- `errors[]` (validation) and `otelTraceId` land later (1.4 / OTel hook) — not built speculatively.
- Strict lint budgets (ADR-0011); no comments.

## Impact Areas

- API / contract: yes (envelope + problem rendering is client-visible)
- DB / migrations: no
- Auth / session: no
- Queue / jobs: no
- Config / secrets: no
- Observability: partial (request-id correlation; structured logs land in 1.8)
- Budget / free-tier footprint: minor (pipeline is trivial CPU)
- CI / release: no

## Acceptance Criteria

1. `createApp()` applies request-id middleware; every response (success, problem, 404) carries `X-Request-Id`; valid inbound ids are echoed; invalid ones are replaced.
2. Envelope helpers render `{ data }` / `{ data, meta }` (`nextCursor?`, `limit`, `hasMore`) / `201 + Location` / `204` with no body.
3. `AppError` renders as RFC7807 with matching `code`/`status`/`title`/`detail`/`traceId`; unknown errors render 500 `INTERNAL` without detail; unmatched routes render 404 `NOT_FOUND`.
4. `src/worker.ts` serves through the app; root returns an enveloped payload.
5. Tests green; `npm run verify` green; roadmap 1.3 checked; plan filed to `completed/`.

## Steps

- [x] Install `hono`
- [x] `src/platform/http`: `types.ts`, `request-id.ts`, `envelope.ts`, `problem.ts`, `app.ts` (+ specs)
- [x] Wire `src/worker.ts` + update `src/worker.spec.ts`
- [x] Verify + roadmap/bookkeeping

## Decision Log

- 2026-10-10: mirror backend request-id validation constants and the status-title map verbatim (dialect). -> clients and tooling rely on identical correlation/error behavior
- 2026-10-10: helpers return `Response` objects (not auto-wrapped middleware) — explicit at the handler, no magic interception. -> Workers/Hono is explicit-by-default; matches the lean platform style
- 2026-10-10: unknown errors render without `detail`; logging arrives with 1.8. -> no leakage before structured logging exists
- 2026-10-10: `created(payload, location?)` keeps `Location` optional. -> 201 stays valid where a resource has no URL yet; schema write rule is unchanged

## Verification

Exact commands and outcomes:

```bash
npm run verify
# format:check ✓, lint ✓, typecheck ✓
# tests: 40 passed across 9 files (25 added: request-id 4, envelope 6, problem 9, app 6)
# build: wrangler dry-run — 828.75 KiB / gzip 134.89 KiB; bindings APP_ENV, LOG_LEVEL
```

## Completion Notes

HTTP foundation landed: `createApp()` with the request-id middleware (family validation constants: ≤ 128 chars, `[A-Za-z0-9._-]`, UUID generation, echo on every response), envelope helpers (`data` / `list` / `created` / `noContent`), and the central problem mapper (`AppError` → RFC7807 with `about:blank` type, status-title map incl. the "Validation Failed" special case, `traceId` = request id, `Retry-After` passthrough; unknown errors → generic 500 without detail; unmatched routes → 404 `NOT_FOUND`). Worker serves through the app; 25 new tests; 40 total green; verify green end to end.

## Follow-ups

- [ ] Structured logging middleware + unknown-error logging land in 1.8
- [ ] Zod validation mapper (`errors[]`, `VALIDATION_FAILED` title path exercised) lands in 1.4
- [ ] `otelTraceId` field joins the problem body when the OTel hook lands
