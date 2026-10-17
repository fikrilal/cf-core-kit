# Section note: `src/features/auth/email-verification`

- Status: Accepted. The two edits below are applied.
- Date: 2026-10-15
- Scope: `POST /v1/auth/email/verify`, `POST /v1/auth/email/verification/resend`, `auth.sendVerificationEmail`, and `consumeEmailVerificationToken`. The rest of `shared/repository.ts` stays where notes 05 and 06 left it.
- Ruler: `_WIP/2026-10-15_cf-core-kit-readability-proposal.md`
- Code changes: `createVerifyEmailHandler` switches on the four outcomes. `emailVerificationTokenInvalid` and `emailVerificationTokenExpired` live in `auth.errors.ts`.

## Verdict

Verify is the endpoint slice. The handler hashes the token, calls one repository function, and returns `noContent()`. Resend is the same shape with the send moved onto the queue: load the user, apply the guards, enqueue, return `noContent()`. The job is the sequence that mints the hash and sends. No service file. ADR-0001 says the handler calls the repository when the policy is this small. Do not add one.

The miss is the verify handler. `consumeEmailVerificationToken` already returns `"ok" | "already_verified" | "token_invalid" | "token_expired"`. The handler branches on two of those strings and lets the other two fall through to 204. A new outcome would succeed with no type error.

No client-facing bug. The consume order, the resend guards, and the job skips match the backend.

## What was read

| File                           | Lines | Role                                                     |
| ------------------------------ | ----- | -------------------------------------------------------- |
| `email-verification.routes.ts` | 216   | verify and resend                                        |
| `email-verification.jobs.ts`   | 204   | producer and `auth.sendVerificationEmail`                |
| `shared/repository.ts`         | 316   | `consumeEmailVerificationToken` only; the file is shared |
| `shared/auth.errors.ts`        | 97    | auth error table; email codes are absent                 |

Specs sampled by case name: `email-verification.spec.ts` (257), `email-verification-resend.spec.ts` (322), `email-verification.jobs.spec.ts` (246). Backend `verifyEmailByTokenHash`, `AuthEmailVerificationService.verifyEmail`, and the resend method on `email-verification.controller.ts` were read for outcome order and status checks.

Platform email, queue, and rate-limit stay closed. The feature calls `email.isEnabled`, `producer.enqueue`, and `assertAllowedOrFailOpen` in a straight line.

## The shape to copy

**Verify.** Public. `captureRawJson`, unknown keys, hash, one repository call, `noContent()`. Not idempotent. A replay after success takes the `already_verified` arm and returns 204 again. The spec locks that replay.

**Resend.** Authenticated. `requireAuth` on the path. No body. The handler order is the policy: email enabled, user present and not `DELETED`, already verified returns 204, per-IP limit then per-user cooldown, enqueue, 204.

**Registration.** Both `app.use` calls are registered before both `app.openapi` calls. That is the order note 06 asks OIDC to adopt. Do not restyle it.

**Job.** `defineJob`, clock from the dependencies, skip or insert-then-send, one log. The jobs pass should not restyle `defineJob`.

## Hard to read

### 1. Verify treats two outcomes as silence

`createVerifyEmailHandler` throws for `"token_invalid"` and `"token_expired"`. `"ok"` and `"already_verified"` are not named. Both are 204 today, which is the right response. The fall-through is the miss.

The return type stays a string union. The four names have no payload. Wrapping them in `{ kind }` would rename the same union. Backend `VerifyEmailResult` uses `kind` because that repository speaks `kind` everywhere. This kit's consume function already names the four strings. Do not convert it.

The throws are raw `AppError` values. Every other auth code in this feature set is a function in `auth.errors.ts`. These two are the gap.

Applied, same status, same code, same message, same 204 for both success arms. `default` assigns `never` and throws `new Error`. `@typescript-eslint/only-throw-error` rejects a thrown `never`.

```ts
switch (outcome) {
  case "ok":
  case "already_verified":
    return noContent();
  case "token_invalid":
    throw emailVerificationTokenInvalid();
  case "token_expired":
    throw emailVerificationTokenExpired();
  default: {
    const unreachable: never = outcome;
    throw new Error(
      `Unexpected email verification outcome: ${String(unreachable)}`,
    );
  }
}
```

The two builders live in `auth.errors.ts` next to the other auth codes. `emailVerificationTokenInvalid` is 400 `AUTH_EMAIL_VERIFICATION_TOKEN_INVALID`, message `"Email verification token is invalid"`. `emailVerificationTokenExpired` is 400 `AUTH_EMAIL_VERIFICATION_TOKEN_EXPIRED`, message `"Email verification token expired"`.

A new outcome then fails the build. It does not become 204, and it does not become invalid by falling through.

## Correct and should stay

- `consumeEmailVerificationToken` is the sequence. Load by hash. Missing token or missing user is `"token_invalid"`. An already verified user marks this token used and returns `"already_verified"` before the revoked, used, and expiry checks. An expired token for an already verified user is 204, not 400. Backend `verifyEmailByTokenHash` uses that same order. The success spec locks the already-verified consume. Do not reorder the checks.
- The verify batch updates the user where `emailVerifiedAt` is null, then marks the token where `usedAt` is null. A 0-row user update returns `"already_verified"`. D1 still applies the token update. Both statements are conditional updates, so a lost race writes nothing. Do not split the batch. Do not read the token update count. The user count is the outcome, matching the backend `updateMany` count.
- Verify does not load status. A `DELETED` user with a live token is verified. Backend verify does not check status either. Resend does reject missing and `DELETED` with 401 `UNAUTHORIZED`, and the resend spec locks that. Those are different policies. Do not point verify at the resend guard.
- `SUSPENDED` can verify and can resend. Backend `requireExistingNonDeletedUser` also allows suspended. Leave both.
- Resend throws 500 `INTERNAL` with `"Email is not configured"` when the port is disabled, and again when enqueue returns false. The first throw is before the user lookup and before the limiter. The spec locks "500 before any other work". Leave both throws next to their checks. A shared helper would hide which guard fired.
- The per-user cooldown is `limit: 1` over `authEmailVerificationResendCooldownSeconds`. The per-IP policy uses the three config fields. Backend resend hardcodes one NX set for the user and config for the IP. The checks stay in the handler because they run after the already-verified return. Moving them into `registerAuthRateLimits` would count a no-op resend. Do not add these routes to that table.
- The job skips a missing user, a `DELETED` user, an already verified user, and a disabled port. Each skip logs a reason and returns. It does not mint a token. The spec locks `user_not_found`, `already_deleted`, `already_verified`, and `email_not_configured`. Leave the guards in that order.
- The job inserts the hash, then sends the raw token. A failed send leaves a hash that was never emailed, and a retry mints a second token. Both stay valid until expiry. Sending first would email a token that is not stored if the insert then fails. Leave insert-then-send.
- `expiresAt` is `new Date(clock.now().getTime() + ttlSeconds * 1000)`. The instant comes from the injected clock. This is not a wall-clock read. Do not add a clock helper for one addition.
- `buildVerificationEmail` keeps the text and the html beside each other. The link is omitted when `publicAppUrl` is blank. The spec locks that. The raw token is base64url. Leave the template.
- There is no sweep for expired email tokens. Backend deletes them on account deletion and does not sweep them either. Account deletion owns that delete. Do not add a cron here.
- `shared/repository.ts` stays one file. This note does not move `consumeEmailVerificationToken`.

## Bugs

None that change a response the tests or the backend describe.

Residual, not a fix in this program: a crash after the job insert and before a successful send leaves an unused hash. The raw token was not returned. Do not treat that window as a reason to send before the insert.

## Design question

The consume sequence stays in `shared/repository.ts`. The send sequence stays in the feature job. The handler keeps the HTTP policy, including the resend limiter, because that limiter is part of the request order. Platform email and queue keep delivery and enqueue.

## Edit this acceptance allows

When this note is accepted, and not before:

1. The outcome switch in `createVerifyEmailHandler`.
2. `emailVerificationTokenInvalid` and `emailVerificationTokenExpired` in `auth.errors.ts`.

No change to status codes, error codes, messages, the consume SQL, the resend order, or the job.

## Verification

`npx vitest run src/features/auth/email-verification/email-verification.spec.ts src/features/auth/email-verification/email-verification-resend.spec.ts src/features/auth/email-verification/email-verification.jobs.spec.ts`

23 tests passed. `npx eslint` and `npx prettier --check` on `email-verification.routes.ts` and `auth.errors.ts` passed. `npx tsc --noEmit` exited 0.

## Next

`_WIP/readability/08-features-auth-push-tokens.md`. It must not reshape `consumeEmailVerificationToken` or the resend handler.
