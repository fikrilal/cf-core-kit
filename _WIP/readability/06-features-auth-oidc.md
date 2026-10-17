# Section note: `src/features/auth/oidc`

- Status: Accepted. The four edits below are applied. The deleted-user bug is fixed.
- Date: 2026-10-15
- Scope: `POST /v1/auth/oidc/exchange`, `POST /v1/auth/oidc/connect`, the Google verifier and JWKS cache in `oidc.ts`, and `registerOidcRoutes`. Identity SQL stays in `shared/repository.ts`. `issueSession` and `auth.errors.ts` stay where note 05 left them.
- Ruler: `_WIP/2026-10-15_cf-core-kit-readability-proposal.md`
- Code changes: `registerOidcRoutes` registers every `app.use` before both routes. `verifyIdToken` switches on `reason`. `body.provider` is threaded through `supportedProvider`. Exchange returns `dataPayload`.
- Sessions: `_WIP/readability/05-features-auth-sessions.md`. This note calls `issueSession` and the named builders. It does not copy them.

## Verdict

The handlers already match the `users/me` steps. Each one reads the validated body, rejects unknown keys, calls one function, and writes. Exchange returns the object envelope. Connect returns `noContent()`. The policy sits in `oidc.service.ts`. Claim checks and the JWKS cache sit in `oidc.ts`. The SQL sequences are `findIdentity`, `insertIdentity`, and `markEmailVerified`.

Three spots are hard to read. `registerOidcRoutes` splits the connect pipeline around the exchange registration. `verifyIdToken` turns any future failure reason into "invalid". The body `provider` is validated and then ignored, while seven call sites repeat the literal `"GOOGLE"`.

One client-facing bug was fixed after the taste edit. `connectOidc` loads the caller before `verifyIdToken`. A missing or `DELETED` user receives 401 `UNAUTHORIZED`, and the verifier is not called. `SUSPENDED` still links. `assertActive` stays on exchange only.

## What was read

| File                         | Lines | Role                                                              |
| ---------------------------- | ----- | ----------------------------------------------------------------- |
| `oidc.routes.ts`             | 193   | exchange and connect routes, handlers, registration               |
| `oidc.service.ts`            | 271   | `exchangeOidc`, `connectOidc`                                     |
| `oidc.ts`                    | 249   | Google verifier, claims, JWKS cache                               |
| `auth.routes.ts`             | 84    | passes the verifier and clock into `registerOidcRoutes`           |
| `src/platform/auth/guard.ts` | 51    | bearer check only; opened to see whether connect reloads the user |

Specs sampled by case name: `exchange.spec.ts` (361), `connect.spec.ts` (320), `oidc.spec.ts` (205). Backend `oidc-auth.service.ts` `connectOidc`, `requireExistingNonDeletedUser`, and `oidc-auth.service.deleted-user.spec.ts` were read for the deleted-user check and the provider argument. The connect error-code list on `oidc.controller.ts` was compared with `oidcOperations`.

`src/platform/auth` does not need its own note. `oidc.ts` already reads as a straight sequence on top of platform JWT decode and RS256 verify.

## The shape to copy

**Exchange.** Public. `captureRawJson`, unknown keys, one service call, object envelope. Not idempotent. Backend exchange has no idempotency decorator. Do not add one.

**Connect.** Authenticated. Same handler steps, then `noContent()`. Middleware order on that path is `captureRawJson`, then `requireAuth`, then `idempotent({ scopeKey: "auth.oidc.connect" })`.

**Issuance.** Exchange calls `issueSession` after `getKeyRing`. That remains the only issuer.

**Errors.** `oidcNotConfigured`, `oidcTokenInvalid`, `oidcEmailNotVerified`, `oidcLinkRequired`, `oidcIdentityAlreadyLinked`, `oidcProviderAlreadyLinked`, `userSuspended`, `internalError`. Call them. Do not add a second table.

**Projection.** Exchange loads `loadMe` and maps with `toMePayload`. A missing row is `internalError`. Do not copy the users mapper.

## Hard to read

### 1. Connect's middleware is split around another route

`registerOidcRoutes` registers both raw-body captures, then `app.openapi(exchangeRoute)`, then auth and idempotency for connect, then `app.openapi(connectRoute)`. A reader has to rebuild the connect pipeline from two ends of the function.

Applied, same paths and same order. Every `app.use` is registered first, then both `app.openapi` calls:

```ts
app.use("/v1/auth/oidc/exchange", captureRawJson());
app.use("/v1/auth/oidc/connect", captureRawJson());
app.use("/v1/auth/oidc/connect", requireAuth(dependencies.clock));
app.use("/v1/auth/oidc/connect", idempotent({ scopeKey: "auth.oidc.connect" }));
```

The paths differ, so connect's auth and idempotency stay off exchange. Connect's order stays capture, then auth, then idempotent.

### 2. `verifyIdToken` hides the failure reasons

`IdTokenVerification` is already `{ ok: true, claims } | { ok: false, reason: "not_configured" | "invalid" }`. The service does not switch on `reason`. Any reason other than `"not_configured"` becomes `oidcTokenInvalid()`. A third reason would be a client-visible change with no type error.

Keep the type. Specs and `oidc.ts` already speak `ok` and `reason`. Do not rename it to `kind`.

Applied, same two errors. `default` assigns `never` and throws `new Error`. `@typescript-eslint/only-throw-error` rejects a thrown `never`.

```ts
if (!verification.ok) {
  switch (verification.reason) {
    case "not_configured":
      throw oidcNotConfigured();
    case "invalid":
      throw oidcTokenInvalid();
    default: {
      const unreachable: never = verification.reason;
      throw new Error(
        `Unexpected id token verification: ${String(unreachable)}`,
      );
    }
  }
}
```

### 3. The validated provider is thrown away

`oidcProviderSchema` is `z.enum(["GOOGLE"])`. Both handlers drop `body.provider`. The service then writes the literal `"GOOGLE"` into `findIdentity`, `findIdentityByUserProvider`, `insertIdentity`, and the user-creation batch. Seven sites. Backend `connectOidc` and `exchangeOidc` take `provider` from the body and pass it through.

Today the enum has one member, so the responses match. The literal is still the miss. A second provider would typecheck at the schema and keep verifying a Google token.

Applied, same Google verifier, same SQL. `provider` is on `ExchangeInput` and `ConnectInput`. One feature-local helper, called once from each entry point, then threaded into the lookups and inserts. The drafted `switch` fails `@typescript-eslint/no-unnecessary-condition` because `OidcProvider` is only `"GOOGLE"`. A `Record<OidcProvider, "GOOGLE">` is the applied form. Adding a member to the enum fails that record at build time. Do not build a verifier map for one provider.

```ts
const supportedProviders: Record<OidcProvider, "GOOGLE"> = {
  GOOGLE: "GOOGLE",
};

function supportedProvider(provider: OidcProvider): "GOOGLE" {
  return supportedProviders[provider];
}
```

### 4. Exchange still builds the envelope by hand

Applied. `createExchangeHandler` returns `context.json(dataPayload(result), 200)`. Note 03 added the helper. This edit does not add it. Connect already uses `noContent()`.

## Correct and should stay

- The create race re-reads. `createUserWithIdentity` inserts the user and the identity in one batch. The `catch` loads the identity by subject. A raced row returns that user after `assertActive`. A raced email throws `oidcLinkRequired`. Anything else rethrows the original error. D1 has no typed unique-violation error. Do not filter the `catch` by a code. Do not delete the lookup that runs before the insert. The fast path and the `catch` are the pair.
- Connect is the same pair. The first `findIdentity` and `findIdentityByUserProvider` return the conflict or the same-user no-op. `insertIdentitySafely` catches and `resolveInsertConflict` reads again. A same-user race returns. Do not delete the first checks.
- An already-linked identity for this user returns before `backfillVerifiedEmail`. The first link backfills only when the provider email is verified, the stored email is not yet verified, and the normalized emails match. Backend connect returns on `already_linked` without a second write. Leave both.
- `validateClaims` turns issuer, audience, expiry, issued-at, subject, email, and `email_verified` into `undefined`. The client sees `AUTH_OIDC_TOKEN_INVALID`. That collapse is the client policy. Leave it.
- The JWKS cache keeps a 10 minute TTL, a 30 second forced-refetch cooldown, and one in-flight load. An unknown `kid` inside the cooldown is served the stale set and then fails as invalid. `lastForcedFetchAt` is set before the fetch finishes. That is the outage containment. Leave the timings.
- `hasKid` treats `kid === undefined` as present. `readEmailVerified` accepts a boolean and the strings `"true"` and `"false"`. `GOOGLE_ISSUERS` includes `https://accounts.google.com` and `accounts.google.com`. Leave them.
- Claims and the cache read `clock.now()`. This file does not use `new Date()` as a clock.
- Exchange `assertActive` stays on exchange only. `DELETED` throws `oidcTokenInvalid` (401 `AUTH_OIDC_TOKEN_INVALID`). `SUSPENDED` throws `userSuspended` (403 `AUTH_USER_SUSPENDED`). `exchange.spec.ts` locks those codes.
- `auth.routes.ts` only chooses the default verifier and clock. Do not restyle the registrar in this pass.
- `consumeEmailVerificationToken` stays for the email-verification note. This note does not split `shared/repository.ts`.

## Bugs

`connectOidc` never loads the user. `requireAuth` verifies the bearer JWT, sets the principal, and does not read `users`. Backend `connectOidc` calls `requireExistingNonDeletedUser` before `verifyOidcIdentityOrThrow`. A missing row or `status === "DELETED"` throws 401 `UNAUTHORIZED`. The backend spec is `blocks connectOidc for DELETED users`.

On this kit that caller falls through. A new subject is inserted and the handler returns 204. `backfillVerifiedEmail` also ignores status, so a deleted unverified user with a matching email can receive `emailVerifiedAt`. `connect.spec.ts` has no deleted case. `UNAUTHORIZED` is already on connect's `errorCodes`. No new code is required to report it.

`SUSPENDED` is not this bug. Backend connect does not call `assertUserIsNotSuspended`. The connect error list on both kits omits `AUTH_USER_SUSPENDED`. `assertActive` maps `DELETED` to `AUTH_OIDC_TOKEN_INVALID` and `SUSPENDED` to `AUTH_USER_SUSPENDED`. Sharing it would change the deleted code and would start rejecting suspended users.

Not a taste edit. The status changes from 204 to 401. The fix loads the user before either identity branch, before backfill, and before the id token. Missing or `DELETED` throws `new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED })`, the same shape `requireAuth` uses. There is no named builder. `SUSPENDED` stays allowed.

Fixed. `connect.spec.ts` locks the missing user, the deleted user, and the suspended link. The two rejections count zero verifier calls and insert no identity.

No other response in the sampled specs is wrong.

## Design question

Verification, linking, and the Google JWKS cache stay in this feature. Platform auth keeps the bearer check, signing, and the key ring. Session issuance stays `issueSession`. The error table stays `auth.errors.ts`.

## Edit this acceptance allows

When this note is accepted, and not before:

1. Group the `app.use` calls in `registerOidcRoutes`, then register both routes. Connect order stays capture, auth, idempotent.
2. The `verification.reason` switch in `verifyIdToken`. The `IdTokenVerification` type stays.
3. Thread `body.provider` through `supportedProvider` into the lookups and inserts.
4. The exchange success return uses `dataPayload` only after note 03 has added it.

No change to status codes, error codes, the race `catch` blocks, JWKS timings, or exchange idempotency. The deleted-user fix is not in this list.

## Verification

`npx vitest run src/features/auth/oidc/exchange.spec.ts src/features/auth/oidc/connect.spec.ts src/features/auth/oidc/oidc.spec.ts`

33 tests passed. `npx eslint` and `npx prettier --check` on `oidc.service.ts` and `oidc.routes.ts` passed. `npx tsc --noEmit` reported no errors.

Bug fix: `npx vitest run src/features/auth/oidc/connect.spec.ts` — 16 passed. `npx eslint` and `npx prettier --check` on `oidc.service.ts` and `connect.spec.ts` passed. `npx tsc --noEmit` exited 0.

## Next

`_WIP/readability/07-features-auth-email-verification.md`. It owns `consumeEmailVerificationToken`. The deleted-user connect bug was fixed in this note after the taste edit.
