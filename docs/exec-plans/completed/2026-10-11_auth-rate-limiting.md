# Auth rate limiting via DO counters (task 3.5)

- Status: completed
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

- [x] Platform rate-limit module + `AuthRateLimiter` DO + wrangler binding/migration + types regen
- [x] Auth routes wiring + tests (limits, isolation, header, fail-open path)
- [x] Boundary lint zones + violation probes; ADR-0012 + README; verify + bookkeeping

## Decision Log

- 2026-10-11: memory-first, zero-storage counters; eviction resets accepted. -> ADR-0007's memory-first directive; D1/KV writes are budget-forbidden for this
- 2026-10-11: 429 is a platform-safety response, not added to x-error-codes. -> preserves exact contract parity while keeping abuse protection honest and documented (ADR-0012)
- 2026-10-11: fail-open on limiter errors. -> an auth outage from a rate-limit outage is worse than a temporary abuse window

## Verification

```bash
npm run verify:ci   # full profile green (11 steps): 240 vitest tests across 39 files, 56 script
                    # fixtures, budget 1166.17 KiB, drift (ADR index complete), parity ok,
                    # spectral ok, build ok
# DO probe: env.AUTH_RATE_LIMITER direct -- allows to the limit, blocks with retryAfter >= 1,
#   isolates per key, rejects malformed requests (400)
# policy probe: logout with a limit-2 policy -> 401, 401, then 429 RATE_LIMITED +
#   Retry-After >= 1 + title "Too Many Requests"; per-address isolation; fail-open on a
#   throwing limiter (request reaches the handler)
# boundary probes: platform -> features, features -> app entry, and cross-feature deep
#   imports each fail lint with the zone message (first platform probe used a wrong
#   relative path; corrected probe fired), then restored; clean lint after
```

## Live Evidence (wrangler dev)

Local end-to-end smoke through real workerd with the real Durable Object binding (`wrangler dev`,
CLI-provided signing keys):

- `GET /.well-known/jwks.json` -> 200 with the public-only key (`kid`/`use`/`alg`/`kty`/`crv`/`x`,
  no `d`), `X-Request-Id` echoed.
- 60 logout calls from one client address -> 401 each; call 61 -> `429 Too Many Requests` with
  `Retry-After: 60` and the dialect problem body (`code: RATE_LIMITED`, `traceId`).
- A second client address stayed allowed (401) while the first was blocked.
- Dev server stopped cleanly afterwards (port released).

## Completion Notes

Auth rate limiting landed as the hibernating, memory-first `AuthRateLimiter` Durable Object
(ADR-0012): fixed windows per policy bucket held entirely in memory (zero storage writes; a
key cap evicts the oldest bucket), at most one DO request per auth operation, per-address keys
(no PII), and fail-open with an error-level log when the object errors. Policies: exchange and
connect 20/min, refresh and logout 60/min (behavior-layer constants, injectable for tests);
JWKS stays unrated (public, cacheable). Exceeding a window returns the dialect's 429
`RATE_LIMITED` problem with `Retry-After` — intentionally undeclared in `x-error-codes` so
parity with the pinned snapshot stays exact (ADR-0012 records the decision). Wiring: DO
binding + sqlite-class migration in every wrangler environment, `wrangler types` regenerated
(`AUTH_RATE_LIMITER` on `Env`), the class exported from `src/worker.ts`. Boundary lint zones
landed (platform ↛ features, features ↛ app entry, `src/shared` purity, cross-feature only via
`index.ts` with an allowlist), each proven by a violation probe. Seven new tests cover the DO
behavior, the 429 dialect, per-address isolation, the fail-open path, and a malformed-decision
guard (the middleware validates the limiter seam and clamps `Retry-After` to at least 1);
existing auth specs inject a permissive limiter factory for determinism.

## Review Round 2 Fixes (adversarial self-review)

An independent review of this task's uncommitted work returned findings, all fixed:

1. **Medium — the 10k key cap was dead code**: each `(policy, address)` bucket is addressed as its own DO object, so a shared registry with oldest-bucket eviction could never run while the ADR and plan described it as live. The cap was deleted and ADR-0012 now documents the per-bucket object model.
2. **Medium — only the logout route proved the limiter**: a recording-limiter test now drives all four limited routes and pins the exact per-route policies (`exchange`/`connect` 20/60, `refresh`/`logout` 60/60) plus the JWKS exemption; a separate test proves headerless requests skip the limiter.
3. **Medium-Low — window rollover was untested**: the window math is now a pure exported function (`evaluateRateLimit`) with deterministic tests for fresh windows, fixed-window stability (not sliding), rollover at the boundary, and the countdown retry hint — an immutability rewrite also fixed a fresh-bucket off-by-one caught by the existing DO test.
4. **Medium-Low — zones had no committed probe**: `scripts/lint/zones.test.mjs` lints violating snippets per zone (through the real config) and enumerates every ordered feature pair, so a new feature without zones fails the gate. `test/**` and `tools/**` stay intentionally out of scope (build-time consumers, not runtime code).
5. **Low — `Partial<AuthRateLimits>` overrides with explicit `undefined`** silently disabled a route; the merge is now per-target with `??`. Wiring moved to `src/features/auth/auth.rate-limits.ts` (module budgets).

Counts after the fixes: 252 vitest tests across 39 files, 60 script fixtures, budget 1167.57 KiB.
