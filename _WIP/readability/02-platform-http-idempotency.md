# Section note: idempotency

- Status: Accepted. The three edits below are applied.
- Date: 2026-10-15
- Scope: `src/platform/http/idempotency.ts`, `idempotency.core.ts`, `idempotency.service.ts`, `idempotency.jobs.ts`, and their specs.
- Ruler: `_WIP/2026-10-15_cf-core-kit-readability-proposal.md`
- Code changes: `resolveConflict` returns `in_progress`. `idempotent` switches on `begin.kind`. The 201 replay names the family downgrade.

## Verdict

This is a straight port of `backend-core-kit` `libs/platform/http/idempotency`. The middleware sequence is the one a feature should never rewrite: hash the request, `begin`, then skip, replay, wait, or run the handler and `complete`. Features pass `scopeKey` and, when needed, `ttlSeconds` or `required`. That split is already right.

Two local shapes hide an outcome the backend states in the open. `resolveConflict` returns `undefined` for "still in progress", and `idempotent` lets `acquired` fall out of the `if` chain. Both are behavior-neutral to name. Everything else that looks odd is family behavior and stays.

The sweep job is already the shape later job notes should copy. One payload, the injected `Clock`, one delete, one log.

No bug.

## What was read

| File                       | Lines | Role                                                      |
| -------------------------- | ----- | --------------------------------------------------------- |
| `idempotency.ts`           | 164   | `idempotent` middleware                                   |
| `idempotency.core.ts`      | 249   | hash canonicalizer, record parse, record builders         |
| `idempotency.service.ts`   | 292   | D1 acquire, replay, wait, complete, release, sweep delete |
| `idempotency.jobs.ts`      | 41    | `http.purgeExpiredIdempotencyRecords`                     |
| `idempotency.spec.ts`      | 338   | middleware outcomes                                       |
| `idempotency.core.spec.ts` | 104   | hash and parse                                            |
| `idempotency.jobs.spec.ts` | 116   | sweep                                                     |

Compared with backend `idempotency.service.ts` and `idempotency.interceptor.ts`. The CF service replaces Redis `SET NX` with `INSERT ... ON CONFLICT DO NOTHING` and replaces key expiry with an `expires_at` column. The outcomes match.

## Hard to read

### 1. `undefined` means "still in progress"

`beginIdempotency` acquires, and on conflict calls `resolveConflict`. That function returns a result for a won race, a replay, and an expired-lock takeover. The matching in-progress row hits `return undefined`. The caller then builds `{ kind: "in_progress" }`.

The backend `begin` returns that kind itself. A reader of the CF split can treat `undefined` as "nothing happened" and skip the wait.

Mobile habit: the helper returns the outcome. Proposed edit, same throws, same kinds:

`resolveConflict` returns `IdempotencyBeginResult`. Its last line is the `in_progress` result it already has the fields for. `beginIdempotency` returns that value directly. The `resolved !== undefined` branch goes away.

### 2. `acquired` is the missing arm

`idempotent` handles `skip`, `replay`, and `in_progress` with early returns. `acquired` is whatever is left, so the `try` / `complete` block reads as the function's leftover rather than a kind.

A new kind would fall into that block and complete a lock it does not hold.

Proposed edit, same calls in the same order. `acquired` contains the `try`, the `release` on throw, and the `complete`. The other arms return. The `default` arm assigns the value to `never` and throws. `@typescript-eslint/only-throw-error` rejects a thrown `never`, so the arm throws `new Error` after that assignment. No new status and no new code.

### 3. The 201 downgrade has no name in the file

`replayResponse` maps stored status `201` to `200` and sets `Idempotency-Replayed`. `idempotency.spec.ts` calls this "the downgraded status". The completed exec plan records it as family behavior. The line itself does not.

Proposed edit: one comment on that assignment. Family replay downgrades `201` to `200`. Do not restore `201`.

## Correct and should stay

- `waitForIdempotencyCompletion` returns `undefined` for a non-positive wait, a missing row, a corrupt row, and a timeout. The middleware answers all four with `409 IDEMPOTENCY_IN_PROGRESS` and `Retry-After: 1`. The backend interceptor does the same. Do not split those causes. A client retry is the recovery for each of them.
- `inProgressError` inside the service has no `Retry-After`. The backend throws that same error when a second acquire loses the race. `Retry-After` belongs only to the wait timeout. Do not add it to the race throw.
- `completeIdempotency` updates the row by key. It does not also check the stored hash. Backend `complete` is a Redis `SET` of the same key. A lock that expired can be overwritten by the request that still holds the old handle. That race is the family's. Do not add a hash predicate in a taste edit.
- Status `>= 400` and an oversized body release the in-progress row and do not cache. The failure and large-body specs pin both. `releaseIdempotency` deletes only an in-progress row with the same hash. Leave that guard.
- `stableStringify` is dense because the hash bounds are the behavior: depth, array length, key count, string length, total characters. `JSON.stringify` would change stored hashes. Leave the function. The truncation markers stay.
- `Date.now()` on the request path is the lock clock, matching the backend. The sweep takes `Clock` and passes `nowMs`, matching every other job. Do not thread `Clock` into `idempotent` from this note. That signature change touches every route mount.
- `createDb(context.env.DB)` stays. This file is a platform module, which is where a binding may be opened.
- `readJsonBody` turns a parse failure into `undefined`, so the hash still runs and the validation hook reports the body. Do not rethrow.
- `idempotency.jobs.ts` stays as it is. `src/jobs.ts` registers `purgeExpiredIdempotencyRecords`. Later job notes copy this file: `defineJob`, clock from the dependencies, one statement, one log line.
- Scope keys stay at the route. `users.me.patch`, `auth.oidc.connect`, and the profile-image upload TTL are product policy. Platform does not grow a table of them.

## Bugs

None. The odd branches match `backend-core-kit`, including the ones that look wrong on a first read.

## Design question

The repeated mechanic already sits in this package. No feature should hash a body, write `idempotency_records`, or set `Idempotency-Replayed` itself. What stays on the route is the scope key and the rare TTL or `required` flag.

## Edit this acceptance allows

Inside these four production files only:

1. `resolveConflict` returns the `in_progress` result, and `beginIdempotency` returns that call.
2. `idempotent` switches on `begin.kind`, with `acquired` holding the current try/complete block and a `never` default.
3. The one-line comment on the `201` downgrade.

No schema change. No status, code, header, or TTL change.

## Verification

`npx vitest run src/platform/http/idempotency.spec.ts src/platform/http/idempotency.core.spec.ts src/platform/http/idempotency.jobs.spec.ts`

21 tests passed. `npx eslint` and `npx prettier --check` on `idempotency.ts` and `idempotency.service.ts` passed.

## Next

`users/me` note: `_WIP/readability/03-features-users-me.md`. It adds `dataPayload` and switches get and patch.
