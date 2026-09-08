# Dev deployment (task 1.13)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0010 (environments, rollback, failure modes), ADR-0005 (budget evidence); roadmap task 1.13

## Objective

Close Phase 1: the wrangler environments land (dev / staging / prod per ADR-0010, each with its own Worker name, vars, and D1 database), `npm run deploy` targets dev, and the first deploy plus `/health` + `/ready` smoke is executed with measured latency per route class recorded as evidence. Because this machine has no Cloudflare credentials, the deploy evidence has two lanes: a **real remote deploy via the temporary preview lane** (`wrangler deploy --temporary`, hidden flag; account provisioned without login) using a scratchpad smoke config without D1, plus a **full local end-to-end smoke** against real workerd with a local D1 (migrations applied). The credentialed remainder (real dev worker with D1, remote `/ready` 200, dashboard CPU numbers) is written up as a precise runbook in the README and tracked as the one open follow-up.

## Constraints

- Environment blocks per ADR-0010: explicit `env.dev` / `env.staging` / `env.prod` with `name`, vars, and D1 bindings; top-level block stays the local dev base mirroring `env.dev`; database ids remain placeholder zero-UUIDs with comments pointing at `wrangler d1 create` (real ids are account-owned; no credentials here).
- `wrangler types` is regenerated after the config change (drift check enforces it); budget/drift checks must stay green.
- Local smoke: real `wrangler dev` (workerd) + local D1; migrations applied first; server stopped afterwards (no lingering processes or ports); `/health`, `/ready`, root, and a 404 problem are exercised with `X-Request-Id` echo checks; latency = wall-clock over 30 warm requests per route class, labeled a proxy (CPU is not wall time).
- Remote smoke: scratchpad config only (never a repo file), no D1 binding (temporary accounts cannot provision D1) — `/health` 200, 404 problem, and the documented `/ready` 503 failure path are exercised live.
- README gains the first-deploy runbook: login, `d1 create` per env, id paste, remote migrations, deploy, smoke, dashboard CPU evidence, secrets discipline. The temporary-lane results are recorded in this plan as evidence, not as a claimed production deploy.
- No commits during the task; bookkeeping and roadmap updates at the end. Nothing here pushes or publishes anything beyond the one temporary preview deployment.

## Impact Areas

- API / contract: no
- DB / migrations: no schema change (local migrations applied to local state only)
- Auth / session: no
- Queue / jobs: no
- Config / secrets: yes (wrangler environments + deploy script; no secrets material anywhere)
- Observability: no code change; dashboard/tail noted in the runbook
- Budget / free-tier footprint: yes (deploy size re-checked via the existing gate)
- CI / release: no CI change; runbook documents the credentialed path
- Docs: yes (README deploy section; roadmap follow-up)

## Acceptance Criteria

1. `wrangler.jsonc` carries dev/staging/prod env blocks; `npm run types` regenerated; budget + drift checks green.
2. Local end-to-end smoke passes: `/health` 200 `{"status":"ok"}`, `/ready` 200 after local migrations (real D1 `SELECT 1`), unknown route 404 with the RFC7807 shape, `X-Request-Id` echoed, server stopped cleanly.
3. Latency evidence per route class recorded (30 warm samples, min/p50/max), labeled as wall-clock proxy.
4. Remote temporary deploy succeeds (or its exact failure is documented); live `/health` smoke passes; `/ready` 503 failure path verified live.
5. README runbook complete enough that the credentialed operator can finish without guessing; roadmap 1.13 checked with the credentialed follow-up explicit; plan filed to `completed/`.

## Steps

- [x] Environments + deploy script + types regen + README runbook
- [x] Local end-to-end smoke (migrate, dev server, curls, latencies, teardown)
- [x] Remote temporary-lane deploy + live smoke
- [x] Verify gate + bookkeeping

## Decision Log

- 2026-10-11: three explicit env blocks instead of top-level-as-dev. -> Worker names stay consistent (`-dev`/`-staging`/`-prod`); the top-level block remains the local base so `wrangler dev` needs no flag
- 2026-10-11: placeholder D1 ids stay placeholders; the runbook owns `d1 create` + id paste. -> ids are account-owned; inventing them would be dishonest config
- 2026-10-11: remote evidence rides the temporary preview lane without D1; `/ready` 200 and CPU numbers are the credentialed follow-up. -> temporary accounts cannot provision D1; claiming otherwise would be gate dishonesty
- 2026-10-11: latency recorded as a wall-clock proxy; CPU per route class comes from the dashboard after the credentialed deploy. -> wall time bounds but does not equal CPU; the label says which is which
- 2026-10-11: the first `/ready` request on the fresh preview deployment returned a platform 1042 (workers.dev propagation); retries served the documented 503. -> recorded as transient, with a sync-throw regression spec closing the one gap the live lane could have hidden

## Verification

Exact commands and outcomes:

```bash
npm run verify        # fast: 8/8 steps green (147 vitest tests; 24 script fixtures)
npm run verify:ci     # full: fast + build (dry-run) -> passed

# Type drift after the config change: `npm run types` regenerated
# worker-configuration.d.ts (+17/-2): APP_ENV widened to "dev"|"staging"|"prod",
# Cloudflare.DevEnv/StagingEnv/ProdEnv interfaces added; drift:check green after.

# Local end-to-end (real workerd + local D1, migrations applied):
#   GET /health 200 {"status":"ok"}   X-Request-Id: smoke-health-1 (echoed back)
#   GET /ready  200 {"status":"ok"}   (real D1 SELECT 1)
#   GET /       200 {"data":{"name":"cf-core-kit",...}}
#   GET /nope   404 application/problem+json NOT_FOUND, traceId == request id
#   wall latency, 30 warm samples (proxy metric, not CPU):
#     health 2.19/2.45/3.26 ms   ready 3.92/4.34/6.05 ms
#     root   2.49/2.73/4.28 ms   nope  2.45/2.67/3.54 ms   (min/p50/max)
#   dev server stopped, port 8787 closed, no leftover processes

# Remote temporary lane (`wrangler deploy --temporary`, no-account preview):
#   upload 842.14 KiB / gzip 136.74 KiB; Worker Startup Time 17 ms
#   https://cf-core-kit-smoke.lucky-earwig.workers.dev (self-expiring preview)
#   /health 200 {"status":"ok"} + x-request-id echo; / 200 envelope
#   /ready 503 problem {"title":"Service Unavailable","errors":[{"field":"db"}]}
#   (no D1 binding on the temporary account)
#   The first /ready attempt after deploy returned a platform 404 "error code:
#   1042" (workers.dev propagation on the fresh deployment); the immediate retry
#   served the 503 problem, proving the app path. A local repro with the same
#   D1-less config returned the exact 503 problem + error-level log line.
#   Regression spec added for the mechanism (synchronous throw inside the
#   readiness check) -> 147 vitest tests.

# Credentialed remainder (follow-up): real D1 ids, remote migrations,
# `/ready` 200 smoke on a real dev worker, dashboard CPU per route class.
```

## Completion Notes

`wrangler.jsonc` now carries explicit `dev` / `staging` / `prod` environments (own Worker name, vars, D1 database; placeholder ids with the runbook owning `d1 create` + id paste) and `npm run deploy` targets dev; `db:migrate:local` follows the dev database name; `wrangler types` regenerated (drift-checked). README gained the first-deploy runbook (login, D1 create per env, remote migrations, deploy, smoke, dashboard CPU evidence, secrets discipline). Evidence: a full local end-to-end smoke against real workerd with local D1 (health/ready 200, envelope root, 404 problem, request-id echo, latency table) and a real remote deploy via the temporary preview lane (842 KiB upload, 17 ms startup, live `/health` + envelope + the documented `/ready` 503 path). The only anomaly — a platform-level 1042 page on the very first `/ready` after deploy — did not reproduce on retry or locally and is recorded as fresh-deployment propagation; the mechanism it could have masked (synchronous throw when the binding is missing) now has its own spec. The credentialed remainder is explicit: real D1 ids, remote `/ready` 200, dashboard CPU per route class.

## Follow-ups

- [ ] Credentialed first deploy: `wrangler login` -> `d1 create` x3 -> id paste -> remote migrations -> `npm run deploy` -> `/ready` 200 smoke -> dashboard CPU per route class recorded (README runbook)
- [ ] Update roadmap cross-cutting item "Runtime evidence (CPU, rows written)" once the credentialed deploy lands
