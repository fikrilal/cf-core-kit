# Cache and Logging (task 1.8)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-10
- Related ADRs / proposals: ADR-0005 (log economy, in-isolate memoization first; public GETs CDN-cacheable), ADR-0008 (platform boundaries); backend `libs/platform/logging` (redaction list, level policy); roadmap task 1.8

## Objective

The cache and logging platform: an in-isolate memoizer with single-flight and TTL (first consumer: JWKS/config caching in later phases), a CDN caching policy helper for the "public GETs are cacheable by default" budget rule, structured JSON logging with backend-ported redaction, and the request/error log lines that complete the committed middleware order (request-id → logging → …).

## Constraints

- Redaction deny list ported from the backend's `DEFAULT_REDACT_PATHS`: `authorization`, `cookie`, `set-cookie`, `x-api-key`, `password`, `token`, `accessToken`, `refreshToken`, `apiKey`, `AUTH_SIGNING_KEYS_JSON`, `OTEL_EXPORTER_OTLP_HEADERS` — matched case-insensitively at any depth (bounded depth 5).
- Logging writes JSON lines to `console` — the one sanctioned console site (eslint `no-console` override for `src/platform/logging/**` only); logging never throws (serialization fallback).
- One log line per request: completions log in the middleware (level by status); thrown errors log in `onError` (warn for expected `AppError`s, error for unknown) — this closes the task-1.3 "unknown errors are not logged until 1.8" note.
- Request logging is wired by composition (worker now, `app.ts` at 1.9), not by `createApp` — the committed order stays intact and tests stay quiet.
- Default skip paths `/health`, `/ready` (backend parity); extra paths configurable.
- `silent` log level and test-env level overrides are deferred (no consumer yet).
- Strict lint budgets (ADR-0011); no comments.

## Impact Areas

- API / contract: no
- DB / migrations: no
- Auth / session: no
- Queue / jobs: no
- Config / secrets: yes (`LOG_LEVEL` consumed for real)
- Observability: yes (structured logs, redaction, request/error lines)
- Budget / free-tier footprint: yes (log-economy rule; request lines are compact JSON)
- CI / release: no

## Acceptance Criteria

1. `memoize` caches within TTL, single-flights concurrent reads (one resolver call), refreshes after expiry, and never caches failures.
2. `cdnCacheControl`/`withCdnCache` render `public, s-maxage=…[, stale-while-revalidate=…]` and preserve unrelated headers.
3. `redactLogFields` redacts the ported key list at any depth (case-insensitive), walks arrays, and truncates beyond depth 5.
4. `createLogger` filters by level, emits JSON with base fields (`service`, `env`), applies redaction, and cannot throw on unserializable fields.
5. `requestLogging` logs completions with method/path/status/duration/requestId, skips `/health`+`/ready`, and `onError` logs thrown errors once per request.
6. Tests green; `npm run verify` green; roadmap 1.8 checked; plan filed to `completed/`.

## Steps

- [x] `src/platform/cache` (memoize, cdn) + specs
- [x] `src/platform/logging` (redact, logger) + specs
- [x] `src/platform/http/request-logging.ts` (middleware + error helper) + spec
- [x] Wire `onError` logging (app.ts) + `requestLogging` (worker.ts); eslint console allowlist
- [x] Verify + roadmap/bookkeeping

## Decision Log

- 2026-10-10: memoizer is caller-owned (factory), single-flight, failures not cached. -> no global state; JWKS retry semantics
- 2026-10-10: CDN helper mutates the response's headers. -> all responses are locally constructed (mutable); consumers keep their other headers
- 2026-10-10: redaction is key-based with the backend's deny list, at any depth. -> pino path patterns don't exist here; the list is what protects secrets
- 2026-10-10: `console` is allowlisted for the logging module via an eslint override. -> the one sanctioned site; the global `no-console` ban stays everywhere else
- 2026-10-10: request logging is composition-wired, not `createApp`-internal. -> keeps tests quiet and the order committed; app.ts formalizes it at 1.9
- 2026-10-10: found in tests — Hono's `app.request()` carries no env (`undefined`); binding/config-dependent specs now share `test/app-request.ts` `send()`. Request logging also skips the completion line when `context.error` is set (compose) so thrown errors log exactly once via `onError`.

## Verification

Exact commands and outcomes:

```bash
npm run verify
# format:check ✓, lint ✓, typecheck ✓
# tests: 140 passed across 25 files (19 added: memoize 4, cdn 3, redact 4, logger 4, request-logging 4)
# build: wrangler dry-run — 833.39 KiB / gzip 136.12 KiB; bindings DB, APP_ENV, LOG_LEVEL
```

## Completion Notes

Cache and logging landed: `memoize` (TTL + single-flight, failures not cached), CDN helpers (`cdnCacheControl` / `withCdnCache`), key-based redaction ported from the backend deny list (any depth, bounded), `createLogger` (level-filtered JSON lines with base fields; serialization fallback; the sanctioned `console` site via an eslint allowlist), and `requestLogging` + `logRequestError` completing the committed pipeline order — one log line per request, `/health` + `/ready` skipped, expected errors at warn, unknown errors at error with stack. `worker.ts` wires request logging; `LOG_LEVEL` is now consumed for real. 19 new tests; 140 total green.

## Follow-ups

- [ ] JWKS cache consumes the memoizer in Phase 3 (auth keyring)
- [ ] Log-economy check (budget task 1.10) and CDN policy usage at 1.9+ routes
- [ ] Optional Tail Worker/OTLP hook remains off by default (ADR-0005)
