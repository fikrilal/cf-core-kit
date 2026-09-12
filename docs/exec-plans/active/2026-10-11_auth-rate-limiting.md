# Auth rate limiting via DO counters (task 3.5)

- Status: active
- Owner: fikrilal
- Risk: high
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0007 (DO memory-first counters; ≤ 1 DO request per auth operation), ADR-0005 (budgets), ADR-0006; roadmap task 3.5

## Objective

Auth paths get abuse protection from a hibernating, memory-first Durable Object: one DO request per auth operation, no storage writes, fixed-window counters per (route, client key) returning the platform dialect's `429 RATE_LIMITED` problem with `Retry-After`. The first feature also triggers the boundary lint rules (platform ↛ features, features ↛ app entry, `src/shared` purity, cross-feature imports only through a feature's `index.ts` with an explicit allowlist).

## Constraints

- DO design: `AuthRateLimiter` class (new sqlite class migration in wrangler config), in-memory buckets (`key → {count, resetAt}`), no `storage.*` writes; an eviction/hibernation reset is acceptable and documented (best-effort limiting). One `fetch` per auth request max.
- Policies (behavior layer, constants in the platform module): per-IP coarse ceilings per route — exchange 20/60s, connect 20/60s, refresh 60/60s, logout 60/60s; key material never raw PII in DO keys (client IP is the key — no emails or tokens in keys).
- Response: `429` `application/problem+json`, `code: RATE_LIMITED`, `title: Too Many Requests`, `Retry-After` from the bucket reset. **Not added to x-error-codes** (exact parity with the pinned snapshot is preserved; the limiter is a platform-safety response, like Cloudflare's own 429/1027 — recorded in a new ADR-0012 with the free-tier cost note: +1 DO request per auth op, DO-budget implications).
- Limiter failure is fail-open with an error-level log (auth availability over strictness), recorded in the ADR.
- Wiring: `requireRateLimit` platform middleware taking a policy; auth routes opt in; wrangler config gains the DO binding + migration tag in all environments; `wrangler types` regenerated (drift gate).
- Boundary lint rules (eslint `import-x/no-restricted-paths` style zones): `src/platform/**` ↛ `src/features/**`; `src/features/**` ↛ `src/app.ts`/`src/worker.ts`; `src/shared/**` ↛ platform/features; cross-feature pairs allowlisted (`auth → users` only, via `index.ts`). Gate honesty: a temporary violating import fails lint (probe), then reverted.

## Impact Areas

- API / contract: no operation change (same codes, same shapes); Auth: abuse protection; Budget: +1 DO request per auth op (documented), zero storage writes; CI/harness: lint zones grow; Config: DO binding.

## Acceptance Criteria

1. Limiter middleware returns 429 + `Retry-After` after the configured ceiling and allows under it; per-IP isolation verified in the pool against the real DO binding; eviction-reset behavior documented.
2. Auth routes wired; happy-path auth tests stay green (limits high enough for the suite — tests use injectable policies).
3. Boundary zones in place with violation probes for each zone; existing tree passes (two features exist).
4. ADR-0012 (mechanism, undeclared-429 decision, fail-open, DO cost) + README note; `npm run verify` + `verify:ci` green; roadmap 3.5 checked.

## Steps

- [ ] Platform rate-limit module + `AuthRateLimiter` DO + wrangler binding/migration + types regen
- [ ] Auth routes wiring + tests (limits, isolation, header, fail-open path)
- [ ] Boundary lint zones + violation probes; ADR-0012 + README; verify + bookkeeping

## Decision Log

- 2026-10-11: memory-first, zero-storage counters; eviction resets accepted. -> ADR-0007's memory-first directive; D1/KV writes are budget-forbidden for this
- 2026-10-11: 429 is a platform-safety response, not added to x-error-codes. -> preserves exact contract parity while keeping abuse protection honest and documented (ADR-0012)
- 2026-10-11: fail-open on limiter errors. -> an auth outage from a rate-limit outage is worse than a temporary abuse window

## Verification

```bash
npm run verify   # (to be recorded)
```
