# users.me.accountDeletion.request (endpoint 9 of 10)

- Status: completed
- Owner: fikrilal
- Risk: high
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0006, ADR-0007; goal: all auth + users endpoints

## Objective

Mount `users.me.accountDeletion.request` (POST /v1/me/account-deletion/request, Idempotency-Key):
schedule deletion 30 days out, refuse when the caller is the last active admin, and answer `204`
idempotently when a deletion is already pending.

## Behavior reference (backend-core-kit)

- Bearer; no body; `204`; declared codes `UNAUTHORIZED`, `IDEMPOTENCY_IN_PROGRESS`, `CONFLICT`,
  `USERS_CANNOT_DELETE_LAST_ADMIN` (409), `INTERNAL`. No rate limit.
- Missing/DELETED user → `401 UNAUTHORIZED`. Last-admin guard runs **first** but only when
  `role ADMIN && status ACTIVE && deletionScheduledFor === null` (count active admins `<= 1` → 409).
- Already pending → `204` no-op: no column writes, no audit; the finalize job is re-armed and the
  reminder is re-scheduled.
- Fresh request writes `deletionRequestedAt`, `deletionScheduledFor` (= now + 30 days, hardcoded),
  `deletionRequestedSessionId`, `deletionRequestedTraceId`, plus audit `REQUESTED`; the status stays
  ACTIVE/SUSPENDED. `MeDto.accountDeletion` becomes `{requestedAt, scheduledFor}`.
- Scheduling: deterministic job `users.finalizeAccountDeletion-<userId>` (re-armed with removeJob
  upstream) + requested email + reminder email 24 h before the due date.

## Design (free-tier mapping)

- 30-day delays exceed the Queues 24 h maximum, so the family's delayed job maps onto the hourly
  sweep: `users.finalizeDueAccountDeletions` selects due users (bounded batch) and enqueues the
  per-user `users.finalizeAccountDeletion` job — same job name, same idempotent handler, transport
  difference recorded. Request/cancel are pure D1 writes.
- Columns `deletion_requested_session_id` / `deletion_requested_trace_id` + the two audit tables land
  here (migration 0005); audits carry the requesting session/trace so finalize can attribute itself.
- Handler order mirrors upstream: principal → user exists/not deleted (401) → guarded repository write
  (last-admin check first, then already-pending, then write + audit) → 204.

## Acceptance Criteria

1. Fresh request → `204`, the four columns set (scheduledFor ≈ now + 30 days), audit `REQUESTED`
   written, `/v1/me` shows `accountDeletion`.
2. Repeat request → `204`, no second audit, stored due date preserved.
3. Last active admin → `409 USERS_CANNOT_DELETE_LAST_ADMIN` and no writes; a second admin makes the
   same request succeed.
4. Unknown/deleted user → 401. Emitted op matches the pin; `verify` green.

## Steps

- [x] Migration 0005 (deletion columns + audit tables) + repository guarded write + audit
- [x] Route + DTO-less request handling + manifest/emit + specs + verify + bookkeeping

## Verification

```bash
npm run db:generate                                    # migration 0005 (deletion columns + audit tables)
npx vitest run src/features/users/account-deletion.spec.ts  # 5 request tests: schedule + audit + me, repeat, idempotent replay, 409 last admin, 401s
# mutation probe: neutering the last-admin guard turns the 409 spec red; revert restores green
npm run contract:emit && npm run contract:check        # op emitted, parity ok
npm run verify                                         # fast profile pass
```

## Completion Notes

The request endpoint schedules 30 days out, writes the `REQUESTED` audit with the requesting
session/trace, keeps the original schedule on repeats (no second audit), and refuses the last active
admin with `USERS_CANNOT_DELETE_LAST_ADMIN` before any write. `MeDto.accountDeletion` surfaces the
schedule. The family's requested/reminder emails are intentionally deferred: the email platform is
ready and the endpoints do not depend on them (recorded as follow-up work rather than partially wired).
