# users.me.accountDeletion.cancel (endpoint 10 of 10)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: goal: all auth + users endpoints

## Objective

Mount `users.me.accountDeletion.cancel` (POST /v1/me/account-deletion/cancel, Idempotency-Key):
clear a pending deletion and answer `204`.

## Behavior reference (backend-core-kit)

- Bearer; no body; `204`; declared codes `UNAUTHORIZED`, `IDEMPOTENCY_IN_PROGRESS`, `INTERNAL`.
- Missing/DELETED user → `401 UNAUTHORIZED`; nothing pending → `204` no-op without audit;
  otherwise reset the four deletion columns and write audit `CANCELED` in one transaction. No grace
  window check (cancel works until finalize runs). The pending reminder job is cancelled; no email.

## Acceptance Criteria

1. Cancel after request → `204`, columns cleared, audit `CANCELED`, `/v1/me.accountDeletion` null.
2. Cancel without a pending request → `204`, no audit row written (row count unchanged).
3. A canceled request can be re-requested (fresh due date + new audit).
4. Emitted op matches the pin; `verify` green.

## Steps

- [x] Repository cancel + audit + route + manifest/emit + specs + verify + bookkeeping

## Verification

```bash
npx vitest run src/features/users/account-deletion.spec.ts  # cancel tests: clears + audit + me null, no-op without pending, re-request after cancel
npm run contract:emit && npm run contract:check             # op emitted, parity ok
npm run verify                                              # fast profile pass
```

## Completion Notes

Cancel clears the four deletion columns, writes the `CANCELED` audit, is a no-op (no audit) without a
pending deletion, and leaves the account immediately re-requestable.
