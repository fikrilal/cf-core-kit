# users.finalizeAccountDeletion — sweep-driven finalize

- Status: completed
- Owner: fikrilal
- Risk: high
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0007, ADR-0006; goal: all auth + users endpoints

## Objective

Execute scheduled account deletions with the family's finalize semantics, driven by the hourly cron
(the 30-day delay cannot ride a queue message): a sweep enqueues `users.finalizeAccountDeletion` per
due user; the handler scrubs the account, purges auth state, and writes the audit trail.

## Behavior reference (backend-core-kit)

- Finalize order: user missing → `user_not_found`; DELETED/deletedAt → `already_deleted`; not scheduled
  → `not_scheduled`; due in the future → `not_due`; ADMIN+ACTIVE with `<= 1` admin → audit
  `FINALIZE_BLOCKED_LAST_ADMIN` and re-arm (+24 h upstream).
- Scrub: `email = deleted+<id>@example.invalid`, `emailVerifiedAt = null`, `role USER`, `status DELETED`,
  `deletedAt = now`, the four deletion columns null, `suspendedAt/suspendedReason` null; profile names
  nulled (displayName/givenName/familyName); delete credentials/identities/email-verification
  tokens/sessions; audits `UserStatusChangeAudit` (old→DELETED) and `UserAccountDeletionAudit`
  `FINALIZED`; traceId = requesting trace (fallback `job:<id>`), actorSessionId = requesting session.
- Idempotent: a second run sees `already_deleted`; skips are successful outcomes (no retry storm).

## Design (free-tier mapping)

- Sweep `users.finalizeDueAccountDeletions` (registered in the hourly cron fan-out, bounded by
  `SWEEP_BATCH_SIZE`): selects non-deleted users with `deletionScheduledFor <= now`, enqueues one
  `users.finalizeAccountDeletion` job per user with `jobId = users.finalizeAccountDeletion-<userId>`
  (deterministic; duplicates are harmless because the handler is idempotent).
- Handler runs one guarded batch: profile-name nulling, account scrub, identity/token/session deletes,
  and the two audit inserts. Sessions delete removes device fingerprints; refresh tokens cascade.
- `blocked_last_admin` hugs the earlier design: the sweep logs it and the next tick re-evaluates.

## Acceptance Criteria

1. A due user finalizes: scrub fields exact (placeholder email, role/status, deletedAt, deletion
   columns null, nulled profile names), identities/tokens/sessions gone, both audits written with the
   request's trace and session.
2. Second run → `already_deleted` without changes; not-due/not-scheduled/unknown users skip.
3. Last-admin due user → blocked with the audit and no writes to the account.
4. Cron integration: seeding a due user and running the scheduled handler finalizes it through the real
   queue; `verify` green.

## Steps

- [x] Repository finalize + audits + guard + sweep selector
- [x] Sweep + consumer jobs, registry wiring + specs + integration + verify + bookkeeping

## Verification

```bash
npx vitest run src/features/users/account-deletion.jobs.spec.ts   # finalize scrub/purge/audits, skip matrix, last-admin block + audit, sweep enqueue shape
npx vitest run test/integration/account-deletion.spec.ts          # real cron → queue → finalize end to end
# mutation probe: neutering the finalize last-admin guard turns the block spec red; revert restores green
npm run verify                                                    # fast profile pass
```

## Completion Notes

Finalize runs the family's scrub (placeholder email, `emailVerifiedAt` nulled, role USER, status
DELETED, `deletedAt`, deletion columns null, suspended fields null, profile names null), purges
identities/verification-tokens/sessions (refresh tokens cascade), and writes both audits attributed to
the requesting session and trace. The hourly sweep enqueues one deterministic `users.finalizeAccountDeletion`
job per due account; blocked-last-admin is audited and retried on the next tick instead of the family's
+24 h re-delay (hourly retry is strictly sooner and idempotent). Deferred: account-deletion emails
(requested/reminder) — the endpoints and the saga are complete without them.

## Post-review fixes (2026-10-12)

- Finalize now clears `profileImageFileId`, retires the account's non-deleted `stored_files` rows, and
  the job enqueues `users.profileImage.deleteStoredFile` for each so avatars are purged from R2 as
  well (an intentional improvement over the family, which leaves both pointer and files behind).
