# Queues and Jobs (normative)

Status: normative (landed 2026-10-11, task 4.1). This standard mirrors backend-core-kit's
`queues-jobs` rules and pins the Cloudflare Queues specifics this kit runs on.

## Transport

- Cloudflare Queues is the only job transport (ADR-0007). One work queue per project plus one
  dead-letter queue, named per environment (`cf-core-kit-jobs-<env>`, `cf-core-kit-dlq-<env>`)
  and declared in `wrangler.jsonc`; `budget:check` asserts the names, the single work queue,
  the DLQ linkage, and the bounds below.
- Features never touch the queue binding or call `send()` — they use the platform producer
  (`src/platform/queue/producer.ts`); `env.JOBS` is confined to `src/platform/` and the
  composition roots by the budget scan.
- Queue names must be created in the account (`wrangler queues create`) before deploying a
  consumer for them; see the README deploy runbook.

## Job names and envelopes

- Job names are dot-separated lowerCamelCase (`users.sweepSessions`, `auth.purgeExpiredTokens`)
  via `jobName()`; queue names match `^[a-z][a-z0-9-]{0,62}$` via `queueName()`.
- Every message is the versioned envelope `{ v, job, jobId, traceId, enqueuedAt, payload }`
  (`jobEnvelopeSchema`). `payload` is nested, so no payload key can collide with platform
  metadata. Payloads carry identifiers, not blobs (ADR-0007); message size is bounded at 128 KB
  and operations are charged per 64 KB.
- Payloads are validated by the job's schema at enqueue time and again at dispatch time. Jobs
  are declared with `defineJob({ name, payloadSchema, handle })`; the worker composes the
  registry with `createJobRegistry`.

## Trace propagation

- `traceId` is the originating request id (`X-Request-Id`) or a synthesized id for work that
  has no request (for example `cron:<timestamp>` in 4.2). It is carried in the envelope, exposed
  to handlers as `JobContext.traceId`, and included in every job log line.

## Idempotency

- At-least-once delivery: handlers must be idempotent by `jobId` (deterministic ids for work
  that can be re-enqueued; `UNIQUE`-style state guards in the handler).
- Business terminal states are successes: a handler that finds nothing to do returns normally
  (the family's `{ ok, outcome, reason }` convention). Only unexpected failures throw, because
  a thrown error is the retry signal.

## Retries and backoff

- Consumer defaults: `max_retries` 3 (never above 5), `max_batch_size` 10 (never above 10),
  `max_batch_timeout` 5s (never above 10s) — enforced by `budget:check`.
- Retries use explicit per-message `retry({ delaySeconds })` with
  `retryDelaySeconds(attempts)` = `30s ** attempts` plus 0.2 jitter, capped at the platform's
  24-hour delay maximum. Retries are extra read operations.
- The consumer helper wraps every message in its own try/catch: an uncaught throw would retry
  the entire batch, and one poisoned message must never re-run healthy messages.
- Malformed envelopes are acknowledged and logged (`job envelope rejected`) — never retried.
  Unknown job names and payload mismatches retry (a deploy may fix them) and dead-letter after
  `max_retries`.

## Dead letters

- Every work consumer declares `dead_letter_queue`; the DLQ has its own consumer that logs each
  dead letter with its envelope (`job`, `jobId`, `traceId`, attempts) and acknowledges it —
  no writes, no retries from the DLQ.
- DLQ deliveries count as read operations against the account's 10,000 operations/day.

## Scheduling and budget

- **One fan-out cron trigger per project** (existing budget rule). The scheduled handler
  enqueues or pokes; it never processes work inline (10 ms CPU per invocation on the Free plan).
- Producer discipline: at most one `enqueue` per API write path by design; typical delivery is
  three operations per message (write, read, delete). Prefer fewer, ID-carrying messages to
  large fan-outs.
- Message retention is fixed at 24 hours on the Free plan: handlers must run fast and must not
  depend on delivery latency; `delaySeconds` is bounded at 24 hours.

## Scheduled sweeps (shipped conventions)

- The single hourly cron (`0 * * * *`, all four scopes) enqueues the registered sweeps and
  returns — it never touches data.
- Jobs are enqueued per tick with `jobId = <job>-<scheduledFor ISO>` and
  `traceId = cron:<scheduledFor ISO>`. The transport has no dedupe, so correctness comes from
  the handlers, not the message ids.
- Sweep handlers are naturally idempotent, bounded deletes: `SWEEP_BATCH_SIZE = 50` rows per
  run through an ordered subquery, so backlogs drain across ticks instead of in one unbounded
  statement. A duplicate tick deletes nothing; a missed tick is not an incident.
- Sweeps are housekeeping, never enforcement — expiry is enforced lazily at use time, so sweep
  latency never affects correctness.
- Current retention: expired sessions (their refresh tokens cascade) and expired idempotency
  records. There is deliberately **no token-only sweep**: the reuse-detection window must
  equal the session lifetime, and the cascade reclaims tokens when the session expires.

## Definition of done for a new job

- `defineJob` next to its feature with a payload schema and a typed handler; registered in the
  worker's `JOB_REGISTRY`.
- Handler unit tests cover the happy path, the idempotent/skip path, and a retryable failure;
  the envelope/trace behavior is covered by the platform helper specs
  (`src/platform/queue/*.spec.ts`).
- Any new consumer or queue change keeps `budget:check` green.
