# Adding background work

Background work runs on Cloudflare Queues (ADR-0007): one work queue plus a dead-letter queue
per environment, a versioned envelope, and handlers that are idempotent by `jobId`. The full
rules are normative in `docs/standards/queues-jobs.md`; this is the practical shape.

```ts
// src/features/<feature>/<name>.jobs.ts
import { defineJob } from "../../platform/queue/registry";

export function createBillingJobs(
  dependencies: Readonly<{ db: Database; clock: Clock; logger: Logger }>,
) {
  return {
    reconcile: defineJob({
      name: "billing.reconcile",
      payloadSchema: schedulePayloadSchema, // { scheduledFor: ISO }
      handle: async (payload, context) => {
        // idempotent by construction; return normally for business skips
        dependencies.logger.info("billing reconciled", {
          jobId: context.jobId,
          traceId: context.traceId,
        });
      },
    }),
  };
}
```

1. Register the jobs in `src/jobs.ts` (`createWorkerJobs`) — the same module feeds the worker's
   `queue` handler and the scheduled fan-out.
2. Enqueue with the producer (`createQueueProducer`), never `env.JOBS` directly: one enqueue per
   API write path, payloads carry IDs (never blobs), deterministic `jobId`s for traceability.
3. Scheduled work goes through the single hourly cron: the `scheduled` handler enqueues; it
   never processes inline. Jobs carry `traceId = cron:<scheduledFor>`.
4. Failures retry with exponential backoff (`retryDelaySeconds`: 30s ** attempts, jittered,
   capped at 24h) via explicit `retry({ delaySeconds })`; after `max_retries` messages dead-letter
   and the DLQ consumer logs them. Business terminal states are successes, not throws.
5. Sweeps are housekeeping, bounded, and idempotent: `SWEEP_BATCH_SIZE` rows per run through an
   ordered subquery, so backlogs drain across ticks and a duplicate tick deletes nothing.

Run `npm run verify:ci` when done — `budget:check` pins the queue bounds, the DLQ linkage, the
confinement of `env.JOBS`, and the per-scope cron budget.
