# Section note: jobs fan-out

- Status: Accepted. The one edit below is applied.
- Date: 2026-10-15
- Scope: `src/jobs.ts`, the `scheduled` handler in `src/worker.ts`, and the queue dispatch those two call. Feature `*.jobs.ts` handlers stay judged in the email, session, idempotency, profile-image, and account-deletion notes.
- Ruler: `_WIP/2026-10-15_cf-core-kit-readability-proposal.md`
- Code changes: `scheduled` is one array and is spread into `createJobRegistry` first.

## Verdict

The fan-out is already one loop. Cron does not run a sweep. It enqueues every `jobs.scheduled` entry with the same `scheduledFor` and the same `cron:` trace id. The queue consumer looks the name up in the registry and calls `dispatch`. That is the copy.

The miss is the two lists. The three cron jobs are written into `scheduled` and written again into `registry`. The type checks that a cron job carries `SchedulePayload`. It does not check that the name is in the registry. A sweep added only to `scheduled` is enqueued, then retried as an unknown job until the dead letter.

No tested response is wrong. The worker spec locks the three names, the job id `${name}-${scheduledFor}`, and the trace id.

## What was read

| File                         | Lines | Role                              |
| ---------------------------- | ----- | --------------------------------- |
| `src/jobs.ts`                | 60    | registry and the cron list        |
| `src/worker.ts`              | 80    | `queue` and `scheduled`           |
| `platform/queue/registry.ts` | 90    | `defineJob`, duplicate-name check |
| `platform/queue/consumer.ts` | 217   | ack, retry, dead letter           |
| `platform/queue/producer.ts` | 155   | `enqueue` returns boolean         |
| `platform/queue/job.ts`      | 54    | envelope and `SchedulePayload`    |

`src/worker.spec.ts` (287) locks the fan-out. `wrangler.jsonc` has one cron, `0 * * * *`, on the root and on each environment. The budget check enforces that per scope. Feature handlers were not reopened.

## The shape to copy

**Cron.** `scheduled` builds the ports, then:

```ts
for (const job of jobs.scheduled) {
  await producer.enqueue(
    job,
    { scheduledFor },
    { jobId: `${job.name}-${scheduledFor}`, traceId },
  );
}
```

`scheduledFor` is `new Date(controller.scheduledTime).toISOString()`. That instant is the cron's time, not `Date.now()`. `traceId` is `cron:${scheduledFor}`.

**Who is on the cron.** `auth.purgeExpiredSessions`, `http.purgeExpiredIdempotencyRecords`, `users.finalizeDueAccountDeletions`. In that order.

**Who is not.** `auth.sendVerificationEmail`, `users.profileImage.deleteStoredFile`, `users.profileImage.expireUpload`, and `users.finalizeAccountDeletion` are enqueued by a request or by another job. Their payloads are not `SchedulePayload`, so the `scheduled` array cannot hold them.

**Queue.** The work queue uses `createQueueConsumer`. A bad envelope is acked and logged. An unknown name, a payload the job rejects, or a thrown handler is retried. The dead-letter queue only logs and acks. It does not write.

## Hard to read

### The cron list is typed twice

`createWorkerJobs` builds `scheduled` as three jobs, then passes those same three into `createJobRegistry` beside the on-demand jobs. `createJobRegistry` throws if a name is registered twice. It cannot see a name that was never passed in.

Applied. One `scheduled` array, spread into the registry first. Cron order stays. Registry order of the on-demand jobs does not matter. A `Map` lookup does not read it. The scaffold still inserts `...create${pascal}Jobs()` on the line after `createJobRegistry([`, so a new feature job is registered and is not added to `scheduled`.

```ts
const scheduled = [
  authSweeps.purgeExpiredSessions,
  idempotencySweeps.purgeExpiredIdempotencyRecords,
  accountDeletion.finalizeDueAccountDeletions,
] as const;

return {
  registry: createJobRegistry([
    ...scheduled,
    sendVerificationEmail,
    profileImage.deleteStoredFile,
    profileImage.expireUpload,
    accountDeletion.finalizeAccountDeletion,
  ]),
  scheduled,
};
```

A new cron job is added in one place and is therefore dispatched. Do not add a `cron: true` flag or a second registry.

## Correct and should stay

- The cron handler does not call `job.handle`. `docs/standards/queues-jobs.md` says the scheduled handler enqueues and returns. The 10 ms cron budget is why. Building `createWorkerJobs` on that path only to read `.name` is the cost of one factory. Do not add a name-only list beside it.
- `enqueue` returns false when the payload, the delay, the id, or `queue.send` fails. The producer logs that. The loop still enqueues the other sweeps. A missed tick is not an incident. The handlers are safe to run twice. Do not fail the cron on one false return.
- Sweep cutoffs use `clock.now()` inside the handler, not `payload.scheduledFor`. The message can run later than the cron instant. `payload.scheduledFor` is the log field and the job id. Session purge, idempotency purge, and due-account selection already work that way. Do not switch them to the payload instant.
- `defineJob` rejects a bad name when the worker starts, through `jobName`. Duplicate names throw inside `createJobRegistry`. Leave both.
- `Date.now()` in the consumer is the batch duration log. It is not a sweep cutoff. Do not inject `Clock` into the consumer for that number.
- One cron expression per Wrangler scope. Do not add a second trigger. Account deletion stays on this cron because a 30-day delay does not fit the queue. That was judged in note 10.
- `defineJob`, the producer, and the consumer stay the platform mechanic. This note does not restyle them. Feature handlers stay in their own notes.

## Bugs

None. The three cron names are in the registry today. The spec locks the fan-out.

## Design question

`src/jobs.ts` is the only list of jobs. `src/worker.ts` is the only cron loop. Platform queue owns the envelope, the retry, and the dead letter. A feature adds a job by exporting it from its `*.jobs.ts` and adding it here. A feature does not register a cron of its own.

## Edit this acceptance allows

When this note is accepted, and not before:

1. Spread `scheduled` into `createJobRegistry`. Same three cron jobs, same order.

No change to job names, payloads, the cron expression, or the consumer.

## Verification

`npx vitest run src/worker.spec.ts src/platform/queue/queue.spec.ts src/platform/queue/consumer.spec.ts src/platform/queue/producer.spec.ts`

24 tests passed. `npx eslint` and `npx prettier --check` on `src/jobs.ts` passed. `npx tsc --noEmit` exited 0.

## Next

This is the last section in the readability order. Its edit is applied. The correctness program and any standards promotion stay out of this pass. The deleted-user connect bug, the profile-image complete raw-body bug, and the equal-id delete enqueue were fixed after this note. See the bug sections in notes 06 and 09.
