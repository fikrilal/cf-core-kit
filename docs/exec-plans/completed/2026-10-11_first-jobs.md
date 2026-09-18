# First jobs: fan-out cron + session/credential sweeps (task 4.2)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0007 (platform service policy), ADR-0005 (budget), ADR-0004 (D1 discipline); roadmap task 4.2

## Objective

The first real jobs land on the 4.1 platform: one hourly fan-out cron that enqueues bounded
sweeps, the sweeps themselves (expired sessions — credentials cascade with them — and expired
idempotency records), and the idempotent-handler pattern with tests that prove it end to end
(two ticks, duplicate-safe). The local queue delivery path is exercised for the first time
through real workerd (miniflare queue consumers in the test pool).

## Behavior reference and design notes

backend-core-kit has **no** sweeps — its recon found expired rows are handled inline at
deletion finalization and there are no session/credential cleanup jobs to mirror. This design
follows ADR-0007 instead ("sessions, idempotency records… TTL sweeps via the fan-out cron").

- **One fan-out cron** (`0 * * * *`, hourly) enqueues the jobs; it never processes inline
  (10 ms CPU per invocation on the Free plan). Per-tick job ids
  (`auth.purgeExpiredSessions-<scheduledFor>`) make ticks traceable; duplicates are harmless
  because sweep handlers are naturally idempotent (bounded deletes remove nothing on re-run)
  and the transport provides no dedupe by design.
- **Sweeps are housekeeping, not enforcement**: expired sessions and idempotency records are
  already rejected at use time (lazy expiry checks); the sweep only reclaims storage, so
  hourly latency is fine and a missed tick is not an incident.
- **No token-only sweep**: rotated refresh tokens must stay until their session ends for reuse
  detection (the grace window for reuse detection _is_ the session lifetime), and the session
  cascade (`refresh_tokens.session_id → sessions.id ON DELETE CASCADE`, live) removes them
  anyway. Deliberate: a token purge with a short grace would silently weaken reuse detection.
- **Bounded deletes**: `SWEEP_BATCH_SIZE = 50` rows per job run, deleting by an ordered
  subquery; backlogs drain over ticks rather than in one unbounded statement (D1 guidance).
- Retention windows: sessions → deleted once `expiresAt <= now`; idempotency records →
  deleted once `expires_at <= now` (ms epoch, as written by the middleware).

## Constraints

- Cron budget: ≤ 1 trigger per scope (root + every environment), now enforced per scope by
  `budget:check` (it previously read only the root scope).
- Handlers stay I/O-bound and take dependencies via factories (`createAuthSweepJobs`,
  `createIdempotencySweepJobs`); the registry is composed per invocation by `src/jobs.ts`
  (`createWorkerJobs`), which both the `queue` and `scheduled` handlers use.
- Jobs log exactly one line per run with `jobId`, `traceId`, `scheduledFor`, and the purged
  count.
- Tests: unit specs for both handlers (retention windows, bounds, repeat-safety), a scheduled
  handler spec (deterministic ids, `cron:<iso>` trace id, both jobs enqueued), and an
  integration spec through real queue delivery (`queueConsumers` in the pool config) proving
  cron → queue → handler → D1 and tick-level idempotency.

## Impact Areas

- Platform/jobs: `src/jobs.ts`; Features: `features/auth/sweep.jobs.ts` + repository purge;
  Platform: bounded idempotency purge + its job; Runtime: worker `scheduled`, hourly cron in
  `wrangler.jsonc`; Tests: pool config gains `queueConsumers`; Budget: per-scope cron check.

## Acceptance Criteria

1. `init` fan-out: the scheduled handler enqueues both sweeps with deterministic job ids,
   `cron:<scheduledFor>` trace id, and the `scheduledFor` payload; it does not touch data.
2. Session sweep: deletes only expired sessions, cascades their refresh tokens, respects
   `SWEEP_BATCH_SIZE`, and a second run over the same data deletes nothing and errors nothing.
3. Idempotency sweep: deletes only expired records, respects the batch bound, is repeat-safe.
4. Integration: with real queue delivery, one cron tick purges seeded expired rows; a second
   tick leaves state unchanged; live rows are never touched.
5. Budget: cron count enforced per scope with fixtures; `verify:ci` green.
6. Standard + roadmap + plan updated; `src/jobs.ts` reflected in the project map.

## Steps

- [x] Platform/job layer: schedule payload, sweep batch default, bounded purge primitives, job factories, `src/jobs.ts`
- [x] Worker `scheduled` handler + hourly cron config + per-scope cron budget check
- [x] Tests (unit ×3, integration ×1) + pool `queueConsumers`
- [x] Docs + verify + bookkeeping

## Decision Log

- 2026-10-11: hourly cron, sweeps as housekeeping. -> lazy expiry already enforces; the sweep only reclaims, so latency does not need to be tight
- 2026-10-11: no token-only sweep. -> the reuse-detection grace window must equal the session lifetime; the cascade already reclaims tokens at session expiry
- 2026-10-11: per-tick deterministic job ids without transport dedupe. -> traceability for operators; correctness comes from naturally idempotent bounded deletes, not from dedupe
- 2026-10-11: job factories over module-level jobs. -> handlers need per-invocation dependencies (db/clock/logger); the registry is composed where the bindings are

## Verification

```bash
npm run verify:ci   # full profile green: 301 vitest tests across 48 files, 66 script fixtures,
                    # budget 1218.14 KiB, drift, parity, spectral, build
# job tests: auth sweep (retention window + cascade + bound 50 + repeat-safe + malformed
#   payload), idempotency sweep (expired-only + bound + repeat-safe), worker queue registry
#   (registered job dispatched end to end through the real registry, unknown jobs retry),
#   scheduled fan-out (both jobs, deterministic ids, cron trace id)
# integration: test/integration/cron-sweeps.spec.ts drives worker.scheduled through the real
#   JOBS binding with the pool's queue consumer (queueConsumers: ["cf-core-kit-jobs-dev"]) and
#   asserts D1 state after the first tick (expired session + cascaded token + expired
#   idempotency record gone; live rows untouched) and a zero-purge, error-free second tick

## Completion Notes

The fan-out cron and both sweeps are live and proven through real queue delivery — the local
queue path now actually runs in the test pool (`queueConsumers`), which is the strongest
evidence this task can produce without deploying: cron → JOBS binding → miniflare delivery →
worker `queue` handler → registry dispatch → bounded D1 deletes, with log assertions on
`jobId`/`traceId`/`purged` for both ticks.

Two deliberate scope decisions are recorded in the standard: no token-only sweep (the reuse-
detection window must equal the session lifetime; the cascade reclaims tokens at session
expiry), and per-tick job ids without transport dedupe (traceability only — correctness comes
from naturally idempotent bounded deletes). `deleteExpiredIdempotencyRecords` existed since
the idempotency work but was unbounded and unwired; it is now bounded (ordered subquery, limit)
and driven by the sweep job. The per-scope cron budget check also closed a real gate gap: it
previously read only the root scope, so a many-trigger environment block would have passed.
```

## Review Round 1 (Pi / Gemini 3.8 Flash High): CHANGES_REQUIRED — resolved

All six findings addressed; the gate was re-run after the fixes (301 vitest tests across 48
files, 66 script fixtures, all checks green).

1. **[High] The batch-bound tests were theater.** They seeded `SWEEP_BATCH_SIZE + 3` rows but
   only asserted the end state after three dispatches, so removing the limit left them green.
   Both specs now assert the intermediate states and the logged counts:
   `[50]` with 3 rows left → `[50, 3]` with 0 rows → `[50, 3, 0]`. Probed for real: with
   `.limit(input.limit)` removed from `purgeExpiredSessions` the test **fails**, and passes
   again once restored — the assertion can now catch an unbounded-delete regression.
2. **[Medium] The second cron tick only awaited the session sweep.** `waitForSecondTick` now
   waits for **both** `sessions purged` and `idempotency records purged` logs for the second
   tick with `purged: 0`, before the console spy is restored — no unawaited queue work and no
   log pollution across tests.
3. **[Medium] `AGENTS.md` was missing `src/jobs.ts`.** The map now lists it (and the stale
   `(planned)` marker on `src/features/` is gone).
4. **[Low] Non-deterministic timestamps/flaky windows.** The idempotency sweep spec uses fixed
   numeric epochs (`now = 1_000_000`) instead of `Date.now()`, and the integration spec's live
   fixtures now expire 24h out instead of 60s.
5. **[Low] Stale fixture count in the plan.** Corrected to 66.
6. **[Nit] Dead `parseCronTriggers`.** Removed from `scripts/budget/check.mjs` (no callers
   remained after the per-scope rewrite).
