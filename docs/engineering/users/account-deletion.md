# Users: account deletion

**What it does.** `POST /v1/me/deletion` requests deletion (scheduling it and auditing the request), `DELETE`
cancels it while the window is open, and the hourly sweep finalizes due accounts: personal fields are scrubbed,
sessions and tokens retired, stored objects enqueued for deletion, and an audit row written for each step.

**Where it lives.** `src/features/users/account-deletion/` (`account-deletion.repository.ts`,
`account-deletion.jobs.ts`, routes), `src/jobs.ts` for the sweep composition.

**Why a sweep and not a delay.** Cloudflare's queue delay ceiling is 12 hours; the 30-day window cannot ride it,
so the saga is sweep-driven with the same observable behaviour (request → window → finalize) as the family's.

**Evidence.** `account-deletion.spec.ts` (request, cancel, guards) and the integration
`account-deletion.spec.ts` (the sweep finalizes a due account and scrubs it) — the `auth.account-deletion` oracle.
