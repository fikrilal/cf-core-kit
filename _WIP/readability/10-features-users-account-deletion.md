# Section note: `src/features/users/account-deletion`

- Status: Accepted. The four edits below are applied.
- Date: 2026-10-15
- Scope: `POST /v1/me/account-deletion/request`, `POST /v1/me/account-deletion/cancel`, the repository, and the two finalize jobs. The profile-image cleanup producer is called and not reshaped.
- Ruler: `_WIP/2026-10-15_cf-core-kit-readability-proposal.md`
- Code changes: request and cancel each switch on their own kinds. Registration is four `app.use` calls. Finalize switches on `kind`. `countActiveAdmins` reads at most two rows.
- Profile image: `_WIP/readability/09-features-users-profile-image.md`.

## Verdict

Request and cancel already return kinds from the repository and `noContent()` from the route. Finalize already returns a kind. There is no service. Do not add one. A service on the backend exists to enqueue a delayed finalize. The grace period is 30 days and the queue delay max is 24 hours, so this kit stores the due time on the user and the cron sweep enqueues. `docs/standards/queues-jobs.md` already says that. Copying the backend scheduler would fight that rule.

The miss is that the two HTTP outcomes share one function, and the job logs by falling through. `runDeletionAction` takes `"request" | "cancel"`, then checks `last_admin`, which cancel cannot return. The other kinds fall through to 204. The finalize job enqueues on `"finalized"`, returns on `"blocked_last_admin"`, and then logs every remaining kind, including `"finalized"`, under the message `"account deletion finalized"`.

No tested response is wrong.

## What was read

| File | Lines | Role |
| --- | --- | --- |
| `account-deletion.routes.ts` | 155 | request, cancel, registration |
| `account-deletion.repository.ts` | 394 | grace, last admin, cascade |
| `account-deletion.jobs.ts` | 183 | one-user finalize and the due sweep |
| `src/jobs.ts` | 60 | where the sweep is registered; the jobs note owns this file |

Specs sampled by case name: `account-deletion.spec.ts` (268), `account-deletion.jobs.spec.ts` (344). Backend `account-deletion.service.ts` and `runFinalizeAccountDeletionTx` were read for the scheduler and the last-admin rule. `docs/standards/queues-jobs.md` and `docs/standards/database.md` were read for the sweep and the row budget.

## The shape to copy

**Request.** Authenticated, idempotent, no body. Live user, one repository call. `"ok"` and `"already_requested"` are 204. A repeat keeps the original `scheduledFor` and does not write a second audit. The spec locks that.

**Cancel.** Same shape. `"ok"` and `"not_requested"` are 204. The spec locks the no-op.

**Registration.** Each path is `requireAuth`, then `idempotent`. Request scope is `users.me.accountDeletion.request`. Cancel scope is `users.me.accountDeletion.cancel`. No raw-body capture. There is no JSON body.

**Finalize.** The repository returns the kind. The job enqueues profile-image cleanup only for `"finalized"`, using the existing producer. `"blocked_last_admin"` logs `"account deletion blocked"` and writes `FINALIZE_BLOCKED_LAST_ADMIN`. The other kinds log `"account deletion finalized"` with `outcome` and, for `"skipped"`, `reason`. The jobs spec locks that list: `finalized`, `skipped:already_deleted`, `not_due`, `skipped:not_scheduled`, `skipped:user_not_found`.

**Sweep.** `findDueAccountDeletions` uses `SWEEP_BATCH_SIZE`, ordered by `deletionScheduledFor`. One enqueue per due user. Job id is `users.finalizeAccountDeletion-${userId}`.

## Hard to read

### 1. One function hides two outcome tables

`runDeletionAction` builds one input and then branches on a string. After the call, `result` is both result types at once. `last_admin` is request-only. `not_requested` is cancel-only. Both success kinds are silent.

Applied. Two handlers, each with its own switch. Same status and same message. `default` assigns `never` and throws `new Error`. `@typescript-eslint/only-throw-error` rejects a thrown `never`. No shared action string.

```ts
switch (result.kind) {
  case "ok":
  case "already_requested":
    return noContent();
  case "not_found":
    throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
  case "last_admin":
    throw new AppError({
      status: 409,
      code: ErrorCode.USERS_CANNOT_DELETE_LAST_ADMIN,
      message: "Cannot delete the last admin",
    });
  default: {
    const unreachable: never = result;
    throw new Error(
      `Unexpected account deletion request: ${String(unreachable)}`,
    );
  }
}
```

Cancel's switch is `"ok"` and `"not_requested"` to `noContent()`, `"not_found"` to the same 401, and `never`. A shared helper may build the input object. It does not take an action string.

### 2. Registration is a loop

Applied. Four `app.use` calls, then two `app.openapi` calls, in the old loop order. The `guards` array is gone.

### 3. The job's log is a fall-through

`createFinalizeAccountDeletionJob` handles `"finalized"` and `"blocked_last_admin"`, then logs whatever is left. `"finalized"` is logged by that tail, not by its own arm. A new kind would be logged as finalized.

Applied. `"finalized"` enqueues, then logs. `"blocked_last_admin"` warns and returns. `"skipped"` and `"not_due"` log and return. Every info log keeps the message `"account deletion finalized"` and the same fields the spec reads (`outcome`, `reason`, `scheduledFor`). The message was not renamed. `default` assigns `never` and throws `new Error`.

### 4. The admin count reads every admin

`countActiveAdmins` selects every active admin id and uses `.length`. The decision is only `<= 1`. `docs/standards/database.md` forbids an unbounded scan. Callers are the request path and the finalize path.

Applied. `limit(2)`, then the same `<= 1` check. Zero or one admin still blocks. Two or more still allows. The response does not change.

## Correct and should stay

- The grace is `accountDeletionScheduledFor`: 30 days from `clock.now()`, in epoch milliseconds. Not a wall clock. Do not add a date helper.
- Request does not enqueue. A 30-day `delaySeconds` is past `MAX_MESSAGE_DELAY_SECONDS` (86400). The due column is the schedule. The hourly cron enqueues `users.finalizeDueAccountDeletions`, which enqueues one finalize per due user. Do not add `scheduleFinalize` on the request.
- `payload.scheduledFor` is not the due check. Finalize reads `users.deletionScheduledFor`. The sweep writes `clock.now()` into the child payload. The spec sends the field. Do not remove it.
- `"already_requested"` returns before the batch. `"not_requested"` returns before the cancel batch. Leave both.
- The last-admin check on request runs only for an active admin with no schedule yet. An admin who is already scheduled gets `"already_requested"` and keeps that date. Finalize blocks only an active admin when the active-admin count is `<= 1`. A suspended admin is not that check. Backend uses the same `ADMIN && ACTIVE` condition. Leave it.
- The request and cancel batches are two statements: the user columns, then one audit insert. That is the API write. Do not split them, and do not add a third statement.
- The finalize batch is the cascade for one user: scrub the user, mark open stored files deleted, delete identities, delete email tokens, delete sessions, insert the status audit, insert the deletion audit. Refresh tokens follow `sessions` via `ON DELETE CASCADE`. `schema.spec.ts` locks the cascade on user delete. Do not add a refresh-token delete. This batch is a job, not the 2–3 row API-write budget. Do not split it across awaits.
- `findOpenStoredFileIds` runs before the batch. The job enqueues those ids after `"finalized"`. A false enqueue is logged and does not fail the job. The file row is already `DELETED`. Do not reshape `createProfileImageCleanupProducer`.
- `requireLiveUser` then a repository `"not_found"` are both 401. The second check is the race after the guard. Leave both.
- `scrubbedEmail` stays `deleted+${userId}@example.invalid`. The spec locks it.
- Blocked finalize does not clear `deletionScheduledFor`. The next sweep selects that admin again and writes another `FINALIZE_BLOCKED_LAST_ADMIN` audit. The account stays active. Do not clear the schedule in this edit. Clearing it would change who the sweep selects.

## Bugs

None that change a response the tests describe.

Residual, not a fix in this program: the last-admin count and the later batch are separate awaits. Backend locks the admin invariant inside the transaction. D1 cannot. Two last admins can both pass the count. The request update also matches on id alone, so a finalize that commits between the read and the batch can write `REQUESTED` onto a row that is already `DELETED`. Do not add a status predicate or a row lock in the taste edit.

`deletionScheduledFor` has no index. The sweep is still capped at `SWEEP_BATCH_SIZE`. An index is a migration. This note does not add one.

## Design question

The kinds stay in the repository, next to the batch. The route only maps them. The sweep stays the scheduler. Platform queue stays the producer. Profile-image cleanup stays that feature's producer.

## Edit this acceptance allows

When this note is accepted, and not before:

1. Separate request and cancel handlers, each switching on its own kind.
2. Unroll `registerAccountDeletionRoutes` into `app.use` calls. Same order.
3. The `result.kind` switch in `createFinalizeAccountDeletionJob`. The info message stays `"account deletion finalized"`.
4. `countActiveAdmins` reads at most two rows.

No change to status codes, error codes, the grace period, the batch statements, the sweep query, or the cleanup producer.

## Verification

`npx vitest run src/features/users/account-deletion/account-deletion.spec.ts src/features/users/account-deletion/account-deletion.jobs.spec.ts`

12 tests passed. `npx eslint` and `npx prettier --check` on `account-deletion.routes.ts`, `account-deletion.jobs.ts`, and `account-deletion.repository.ts` passed. `npx tsc --noEmit` exited 0.

## Next

`_WIP/readability/11-jobs-fan-out.md`. Feature handlers already judged stay judged. Do not reshape the profile-image cleanup producer.
