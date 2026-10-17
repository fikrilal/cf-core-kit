# Section note: `src/features/auth/push-tokens`

- Status: Accepted. The two edits below are applied.
- Date: 2026-10-15
- Scope: `PUT /v1/me/push-token`, `DELETE /v1/me/push-token`, and `push-token.repository.ts`. Session revocation already clears these columns in `shared/repository.ts`. That sequence stays where note 05 left it.
- Ruler: `_WIP/2026-10-15_cf-core-kit-readability-proposal.md`
- Code changes: `createPushTokenUpsertHandler` switches on `ok` and `session_not_found`. One comment sits above the upsert batch.
- Email: `_WIP/readability/07-features-auth-email-verification.md`. This note does not reshape the resend handler or `consumeEmailVerificationToken`.

## Verdict

This is the copy target for a feature whose SQL is not shared. The handler reads the body, rejects unknown keys, calls one repository function, and returns `noContent()`. The repository is the batch. There is no service. ADR-0001 says not to add one. The policy is two guards and a 204.

The miss is the same one email verify had, and smaller. `upsertSessionPushToken` returns `"ok" | "session_not_found"`. The handler names only the failure. `"ok"` falls through to 204.

No client-facing bug. The disabled-provider gate, the deleted-user gate, the live-session rule, and the revoke all match the backend.

## What was read

| File | Lines | Role |
| --- | --- | --- |
| `push-token.routes.ts` | 157 | upsert and revoke |
| `push-token.repository.ts` | 90 | the batch and the clear |
| `shared/repository.ts` | 316 | `readChangeCount` only; the file is shared |

Specs sampled by case name: `push-token.spec.ts` (375), `push-token.repository.spec.ts` (109). Backend `MePushTokenController`, `AuthPushTokensService`, and `upsertSessionPushToken` in `prisma-auth.repository.sessions.ts` were read for the gate order and the live-session rule.

Platform push stays closed. The feature calls `push.isEnabled()` and does not send.

## The shape to copy

**Upsert.** Authenticated. `captureRawJson` and `requireAuth` on the path, then the handler. Provider enabled, live user, unknown keys, one repository call, `noContent()`.

**Revoke.** Same path, no body, no provider check. Live user, one clear, `noContent()`. A second call is 204. The spec locks that, including when push is disabled.

**Registration.** Both `app.use` calls come before both `app.openapi` calls. `captureRawJson` sits on the path, so DELETE runs it too. A DELETE body that is not JSON sets `rawJson` to `undefined` and continues. Revoke never reads it. Do not split the middleware by method.

**Folder.** The operation ids are `users.me.pushToken.*` and the tag is Users. The code stays under `src/features/auth/push-tokens` because the rows are session columns. Do not move the folder. The import churn hides the diff.

## Hard to read

### 1. Upsert names only the failure

`createPushTokenUpsertHandler` throws when `outcome === "session_not_found"` and otherwise returns 204. The success arm is silence. A new outcome would succeed with no type error.

The return type stays a string union. The two names have no payload. Do not wrap them in `{ kind }`. Backend uses `kind` because that repository speaks `kind` everywhere.

The 401 stays an inline `AppError`, the same shape `requireAuth` and `requireLiveUser` use. Do not add an `unauthorized` builder for one arm.

Applied, same status and same code. `default` assigns `never` and throws `new Error`. `@typescript-eslint/only-throw-error` rejects a thrown `never`. The 401 stays an inline `AppError`.

```ts
switch (outcome) {
  case "ok":
    return noContent();
  case "session_not_found":
    throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
  default: {
    const unreachable: never = outcome;
    throw new Error(`Unexpected push token outcome: ${String(unreachable)}`);
  }
}
```

### 2. The live-session guard is easy to split

The batch clears the token on every other session, then writes it on the caller. The clear's `WHERE` includes `sessionIsLive`, an `EXISTS` on the caller's session: same user, not revoked, `expiresAt` still ahead of `now`. That predicate is why a revoked caller does not take the token off someone else. The spec locks that case.

Backend does this with a locking update inside a serializable transaction, then the clear, then the write, and retries a unique violation on `pushToken`. D1 has no row lock and no typed unique-violation error. The `EXISTS` on the same batch statement is the Workers shape. A prior `await` that checks the session, then a second `await` that clears, opens a gap where the caller dies and the clear still runs.

Applied. One comment above the batch says the clear stays in this batch because a dead caller must not clear another session, and the check must not become its own await. No SQL change.

## Correct and should stay

- The 501 gate is first. `push.isEnabled()` false throws 501 `AUTH_PUSH_NOT_CONFIGURED`, message `"Push provider is not configured"`, before `requireLiveUser` and before the batch. The spec locks "501 and touches nothing". Backend checks `isEnabled` before `requireExistingNonDeletedUser`. Do not move the user load above this throw. One call site. Leave the `AppError` inline.
- Revoke does not check `isEnabled`. A disabled provider still clears. The spec calls revoke with push disabled and expects 204. Backend revoke skips the provider check too.
- `requireLiveUser` is the deleted-user guard for both handlers. Missing or `DELETED` is 401 `UNAUTHORIZED`. `SUSPENDED` continues. Backend `requireExistingNonDeletedUser` is the same rule. The helper has two call sites here, so it stays in this file. Do not move it into `shared/repository.ts` and do not point email resend at it. That handler was judged in note 07.
- The returned user is unused. The function is a guard. Leave the lookup. Do not start a user policy from the unused row.
- Revoke updates by session id and user id only. It does not check revoked or expired. Zero rows still return 204. Another user's session is unchanged. Backend `revokeSessionPushToken` is the same update. Do not make revoke return an outcome.
- The caller update sets `updatedAt`. The clear of the other session does not. Backend's clear also leaves `updatedAt` alone. Do not add `updatedAt` to the clear, and do not drop it from the caller update.
- `body.platform` is the schema enum after trim and upper case. The handler stores it. Do not switch on `ANDROID` / `IOS` / `WEB` with no policy in the arm.
- The route text says the operations are idempotent. That means a repeat is a 204, not that `Idempotency-Key` is accepted. Do not add the header. The published contract has no such parameter.
- `readChangeCount` stays imported from `shared/repository.ts`. Rotate and email consume use it too. Do not relocate it in this pass.
- Session revoke and the device-session replace already null these columns inside their own batches. Note 05 owns those batches. The repository spec locks the session-revoke clear. Do not copy that `SET` into the push repository.

## Bugs

None that change a response the tests describe.

Residual, not a fix in this program: two live callers upserting the same new token can hit the unique index on `push_token`. Backend retries that violation inside the transaction. This kit does not, and it has no typed unique-violation error, so a filter on the error text is the wrong fix. An uncaught failure is already 500 `INTERNAL`, which the operation lists. Do not add a blind second batch in the taste edit.

## Design question

The batch stays in this feature. The session row stays the store. Platform push stays the enabled flag. `requireLiveUser` stays local until some later note has a real second feature that must share it.

## Edit this acceptance allows

When this note is accepted, and not before:

1. The outcome switch in `createPushTokenUpsertHandler`.
2. The one comment above the batch in `upsertSessionPushToken`.

No change to status codes, error codes, the batch statements, or revoke.

## Verification

`npx vitest run src/features/auth/push-tokens/push-token.spec.ts src/features/auth/push-tokens/push-token.repository.spec.ts`

11 tests passed. `npx eslint` and `npx prettier --check` on `push-token.routes.ts` and `push-token.repository.ts` passed. `npx tsc --noEmit` exited 0.

## Next

`_WIP/readability/09-features-users-profile-image.md`. Do not add `captureRawJson` on complete in the taste unroll. The missing raw-body capture and the equal-id delete enqueue stay bug notes.
