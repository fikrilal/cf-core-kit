# Queue platform: jobs, retries, DLQ (task 4.1)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0007 (platform service policy), ADR-0005 (free-tier budget); roadmap task 4.1

## Objective

The queue platform lands: Cloudflare Queues bindings configured per environment, a typed job
envelope with trace propagation, producer and consumer helpers, retry/backoff defaults that
mirror the BullMQ baselines from backend-core-kit, a dead-letter policy with its own consumer,
the budget checks for queue operations, and the `queues-jobs` standard. No jobs yet — 4.2 adds
the first fan-out cron and sweeps; this task makes defining them safe.

## Free-tier facts (verified against the live docs, pages updated 2026-04-21)

- Queues limits page: "The following limits apply to both Workers Paid and Workers Free plans
  with the exception of **Message Retention**, which is non-configurable at 24 hours for the
  Workers Free plan." (The 24h fixed retention is exactly what ADR-0007 assumed.)
- Queues pricing page: Workers Free includes **10,000 operations/day** (one operation per 64KB
  written/read/deleted; retries and DLQ writes are extra operations). Paid: 1M ops/month +
  $0.40/million.
- Message size 128 KB; message retries up to 100; max consumer batch 100 messages; max batch
  wait 60s; `delaySeconds` up to 24h; consumer wall time 15 min; consumer CPU shares the
  Worker CPU limits (10 ms on Free) — handlers stay I/O-bound by design.
- Batch/retry mechanics: explicit per-message `ack()`/`retry({delaySeconds})`; an uncaught
  throw retries the whole batch, so every message is processed inside its own try/catch;
  after `max_retries` a message is written to `dead_letter_queue` or dropped if none is set.

## Behavior reference (backend-core-kit) and the Cloudflare mapping

| Concern                        | backend-core-kit (BullMQ)                                                                               | here (Cloudflare Queues)                                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job naming                     | `jobName()` regex `^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$`; `queueName()` `^[a-z][a-z0-9-]{0,62}$` | identical patterns and error shape                                                                                                                    |
| Envelope                       | payload spread + reserved `__meta.otel` (`traceparent`/`tracestate`)                                    | versioned envelope `{v, job, jobId, traceId, enqueuedAt, payload}` — payload nested, no reserved-key collisions                                       |
| Trace                          | W3C traceparent inside `job.data.__meta`                                                                | `traceId` = the request id (`X-Request-Id`) or a synthesized job id; consumer logs carry it                                                           |
| Retries                        | `attempts: 5`, exponential backoff 1s + jitter 0.2                                                      | `max_retries: 3` (CF default) with explicit `retry({delaySeconds})` backoff `base**attempts` (base 30s) + jitter 0.2, capped at the 24h delay maximum |
| Retention                      | `removeOnComplete/removeOnFail` counts                                                                  | 24h fixed on Free (ADR-0007's bound); DLQ retains failed messages for inspection                                                                      |
| DLQ                            | failed-state set + runbook (no DLQ queue)                                                               | real `dead_letter_queue` + a DLQ consumer that logs and acks                                                                                          |
| Ack model                      | BullMQ job completion                                                                                   | explicit per-message `ack()`/`retry()` so one bad message never re-runs a whole batch                                                                 |
| Deliveries that must not retry | business states are successes (`{ok:true, outcome:'skipped'}`)                                          | same convention: only thrown errors retry; handled states return normally                                                                             |

## Constraints

- One job queue per project plus one DLQ, both named per environment (`cf-core-kit-jobs-<env>`,
  `cf-core-kit-dlq-<env>`); queue names live in `wrangler.jsonc` and are asserted against the
  platform naming helpers by the budget check.
- Consumer configuration bounded for the free tier: `max_batch_size ≤ 10`,
  `max_batch_timeout ≤ 10s`, `max_retries ≤ 5`, every work consumer declares a DLQ.
- Free-tier ops: 10k operations/day account-wide, one operation per 64KB written/read/deleted;
  retries are extra reads; DLQ deliveries are reads. Payloads carry IDs, not blobs (ADR-0007).
- Queue binding access (`env.JOBS`) stays inside `src/platform/` and the composition roots
  (`src/app.ts`, `src/worker.ts`) — enforced by the budget scan, like `context.env`.
- Malformed envelopes are acked and logged (never retried — retrying garbage poisons the queue);
  unknown job names and payload mismatches retry (a deploy may fix them) and dead-letter after
  `max_retries`.
- The registry is empty in this task on purpose; the consumer, DLQ consumer, and worker routing
  are wired and tested so 4.2 only adds job definitions.

## Impact Areas

- Platform: new `src/platform/queue/` module; Budget: new checks + config bounds; Deployment:
  queue bindings per environment (placeholder queue names until `wrangler queues create`); Docs:
  first `docs/standards/` prose (queues-jobs).

## Acceptance Criteria

1. Envelope and naming: `jobName`/`queueName` reject invalid shapes with the family's error
   message; the envelope schema round-trips and rejects malformed messages.
2. Producer: validates payloads before send, stamps `{v, job, jobId, traceId, enqueuedAt}`,
   supports `delaySeconds` (≤ 86400) and deterministic `jobId`s, and returns `false` plus an
   error log when the send fails instead of breaking the caller.
3. Consumer: explicit per-message `ack()`/`retry()`; malformed envelope → ack + error log;
   unknown job / payload mismatch / handler throw → `retry({delaySeconds})` with the documented
   backoff; one summary log per batch with counts; the DLQ consumer logs dead letters and acks.
4. Retry/backoff: `retryDelaySeconds` is exponential with jitter, capped at 24h, deterministic
   under an injected random source.
5. `wrangler.jsonc` carries the queue bindings for root/dev/staging/prod; `wrangler types`
   regenerated (drift-checked); the worker exports a `queue` handler that routes work vs DLQ.
6. Budget checks: queue config (DLQ present, bounds, naming, single work queue) and binding
   confinement, with `node:test` fixtures; `npm run verify:ci` green.
7. `docs/standards/queues-jobs.md` lands (normative) and the standards index marks it active.

## Steps

- [x] Platform queue module (names, envelope, registry, defaults, producer, consumer, DLQ)
- [x] wrangler queue bindings + types regen + worker `queue` handler routing
- [x] Budget checks (config + confinement) with fixtures
- [x] Standard doc + tests + verify + bookkeeping

## Decision Log

- 2026-10-11: the envelope nests `payload` instead of spreading it, unlike the backend's reserved `__meta`. -> removes the reserved-key hazard entirely; validation is structural
- 2026-10-11: malformed envelopes are acked, unknown jobs retry. -> garbage never retries (poisoning), version skew gets max_retries attempts and then the DLQ
- 2026-10-11: one work queue + one DLQ for the project. -> free-tier ops are account-wide; per-domain queues only multiply consumer surface without budget benefit
- 2026-10-11: explicit per-message ack/retry (never a thrown batch error). -> a single poisoned message must not re-run every message in its batch

## Verification

```bash
npm run verify:ci   # full profile green (11 steps): 290 vitest tests across 45 files, 64 script
                    # fixtures, budget 1211.08 KiB (queue checks included), drift, parity ok,
                    # spectral ok, build ok
# queue-specific: 18 tests (queue.spec: naming/envelope/backoff/registry; producer.spec:
#   envelope/delay/identifiers/validation/send-failure; consumer.spec: dispatch context,
#   retry backoff + mixed batch, malformed/unknown/mismatch handling, DLQ logging;
#   worker.spec: real routing through the exported worker with captured logs for both queues)
#   + 4 budget fixtures (scope bounds, DLQ linkage, naming pinned to names.ts, confinement)
# config gates: `wrangler types` regeneration is drift-checked, and `wrangler deploy --dry-run`
#   (the budget step) validates the queues blocks with the rest of the config
# local queue delivery itself is exercised in 4.2 when the first real jobs exist

## Completion Notes

The queue platform is in place per ADR-0007: one work queue + one DLQ per environment, a
versioned envelope with `traceId` propagation, typed job definitions, producer/consumer/DLQ
helpers with explicit per-message ack/retry, exponential-with-jitter backoff capped at the 24h
delay maximum, and budget checks that pin the naming, the DLQ linkage, the consumer bounds, and
`env.JOBS` confinement. The worker exports the `queue` handler with the registry empty on
purpose — 4.2 adds the first job definitions and the cron schedule, and the local queue
delivery path gets exercised live there.

Two things belong in the record. First, an intermediate rewrite of this plan on 2026-10-11
claimed Queues was paid-only and proposed a D1 ledger; that claim was **not** from a page
actually read (a fetch had failed), the live limits and pricing pages were then re-verified
("both Workers Paid and Workers Free plans…", "Workers Free: 10,000 operations/day"), and the
pivot was reverted — the final artifact above matches the verified facts. Second, the queues
blocks must be declared **inside each environment object**; a misplaced insertion created a
bogus `env.queues` scope and made wrangler mark every base binding optional, which the
`wrangler types` drift check surfaced as a type-shape change in the regenerated file.

The check script cannot import `src/` constants (Node cannot follow the source tree's
extensionless TS imports), so `check.mjs` owns the queue prefixes and a committed fixture pins
them to `src/platform/queue/names.ts` by reading the source text — the coherence is still
test-enforced, just not via an import.
```

## Review Round 1 (Pi / Gemini 3.8 Flash High): CHANGES_REQUIRED — resolved

All six findings addressed; the gate was re-run after the fixes (293 vitest tests across 45
files, 65 script fixtures, budget/drift/parity/spectral/build green).

1. **[High] `src/worker.spec.ts` lost the `worker.fetch` tests.** The file already existed; the
   new queue-routing suite overwrote it. The original three tests (root banner envelope,
   not-found problem, health/readiness through the composition) are restored alongside the
   queue routing block — the suite count moved 290 → 293 by exactly those tests.
2. **[Medium] `payload.data as never` in the consumer.** The registry no longer needs erasure
   casts: `defineJob` now builds a `dispatch(rawPayload, context)` closure that validates with
   the job's schema and passes the **typed** data to `handle`, returning
   `{ ok: true } | { ok: false; reason }`. `AnyJob` is `{ name, dispatch }` and the `anyJob`
   identity helper is deleted; the consumer calls `dispatch` with no assertions. Production
   code under `src/**` is back to zero assertion casts (verified by grep).
3. **[Medium] Empty `jobId`/`traceId` could be enqueued and then discarded as malformed.**
   `resolveIdentifiers` rejects empty and over-long identifiers before send with a
   `job identifier invalid` error log; tests cover both empty cases and assert no send happens.
4. **[Low] Producer logs omitted `traceId`.** `job enqueued` and `job enqueue failed` now carry
   `traceId`, matching the standard's "included in every job log line".
5. **[Low] `$schema` was commented out by the wrangler rebuild.** The missing newline between
   the header comment and `"$schema"` is restored; types regenerated (drift-checked).
6. **[Low] `checkQueueConfig` passed silently when a scope omitted its `queues` block.**
   Required scopes (`root`, `env.dev`, `env.staging`, `env.prod`) are now asserted to declare
   their blocks, with a new fixture; the existing fixtures were upgraded to realistic
   full-config mutations rather than single-scope snippets.
