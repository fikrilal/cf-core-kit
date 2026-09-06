# Health And Boot (task 1.9)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-10
- Related ADRs / proposals: ADR-0002 (dialect shapes), ADR-0005 (log economy: health checks unpolled/quiet), ADR-0001 (one composition root); backend `libs/platform/health` (shapes ported); roadmap task 1.9

## Objective

Liveness and readiness endpoints plus the composition root: `GET /health` → `{ status: "ok" }`, `GET /ready` → `{ status: "ok" }` after a D1 probe (503 problem when it fails), both envelope-skipped and already on the request-logging skip list; `src/app.ts` becomes the composition root (pipeline + health + the scaffold root route) and `src/worker.ts` collapses to the thin handler export.

## Constraints

- Shapes ported from the backend: `health.get` / `ready.get` return `{ status: "ok" }` raw (SkipEnvelope semantics), and readiness failure is `503` with `title: "Service Unavailable"`, `detail: "Readiness checks failed"`, `code: INTERNAL`, `errors: [{ field: "db", message }]` — our problem mapper derives title/status from the same mapping.
- Readiness always checks D1 (the binding is always present); the backend's "check only when enabled" gating has no equivalent here — recorded as a deliberate divergence.
- The readiness dependency is injectable at registration so the 503 branch is testable without faking bindings (mirrors the backend's injectable `ReadinessService`).
- Detail for the failure issue is `"D1 not ready"` (the underlying error is not surfaced; readiness failures are logged via `onError` at error level, which is acceptable noise for an unhealthy service).
- `src/app.ts` is the only composition root (ADR-0001): request pipeline, request logging, health routes, scaffold root route; `worker.ts` only exports the handler.
- Strict lint budgets (ADR-0011); no comments.

## Impact Areas

- API / contract: yes (new endpoints; envelope-skipped shapes are client-visible)
- DB / migrations: no (readiness probes with `SELECT 1`)
- Auth / session: no
- Queue / jobs: no
- Config / secrets: no
- Observability: yes (readiness failures surface as error logs; success lines stay skipped)
- Budget / free-tier footprint: yes (cheap probe; health checks are not CDN-cached and not polled aggressively by design)
- CI / release: no

## Acceptance Criteria

1. `/health` returns `200` with `{ status: "ok" }` without the envelope and with `X-Request-Id` echo.
2. `/ready` probes D1 via the binding and returns `{ status: "ok" }`; a failing dependency yields the backend-shaped 503 problem with `errors[]`.
3. `src/app.ts` composes pipeline + logging + health + root; `src/worker.ts` is the thin handler export; the root banner still serves inside the envelope.
4. Tests green; `npm run verify` green; roadmap 1.9 checked; plan filed to `completed/`.

## Steps

- [x] `src/platform/health/health.ts` (routes + `evaluateReadiness` + injectable dependency)
- [x] `src/app.ts` composition root; `src/worker.ts` thin export
- [x] Specs: health unit/integration + worker composition additions
- [x] Verify + roadmap/bookkeeping

## Decision Log

- 2026-10-10: readiness dependency injectable at registration. -> the 503 branch is testable without violating the no-assertions rule against fake bindings
- 2026-10-10: D1 probe always runs (no enabled/disabled gating). -> the binding always exists; the backend's gating was for optional infrastructure
- 2026-10-10: failure detail issue is `"D1 not ready"`; the underlying error is not surfaced in the response. -> no internal details on a probe endpoint
- 2026-10-10: readiness failures log at error level through `onError`; success lines stay on the skip list. -> healthy polling is silent; unhealthy polling is visible

## Verification

Exact commands and outcomes:

```bash
npm run verify
# format:check ✓, lint ✓, typecheck ✓
# tests: 146 passed across 26 files (6 added: readiness 2, health routes 3, composition 1)
# build: wrangler dry-run — 834.51 KiB / gzip 136.44 KiB; bindings DB, APP_ENV, LOG_LEVEL
```

## Completion Notes

Health and boot landed: `registerHealthRoutes` serves `GET /health` and `GET /ready` (`{ status: "ok" }`, envelope-skipped) with an injectable D1 readiness probe; failures render the backend-shaped 503 problem (Service Unavailable / Readiness checks failed / `errors[{ field: "db" }]`) and log at error level, while healthy checks stay on the request-logging skip list. `src/app.ts` is now the composition root (pipeline, request logging, health, scaffold root) and `src/worker.ts` is the thin handler export. 6 new tests; 146 total green.

## Follow-ups

- [ ] Dev deployment smoke (`/health` + `/ready` + measured CPU) at task 1.13
- [ ] OpenAPI operations (`health.get`, `ready.get`) land with the contract pipeline (Phase 2)
