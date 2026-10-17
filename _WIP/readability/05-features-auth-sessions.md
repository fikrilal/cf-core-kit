# Section note: `src/features/auth/sessions`

- Status: Accepted. The four edits below are applied.
- Date: 2026-10-15
- Scope: refresh, logout, session list, session revoke, JWKS, the session sweep, and the session functions in `src/features/auth/shared/`. Identity helpers and `consumeEmailVerificationToken` stay in that file and are not reshaped here.
- Ruler: `_WIP/2026-10-15_cf-core-kit-readability-proposal.md`
- Code changes: `refreshSession` switches on `RefreshDecision`. `rotateRefreshToken` returns `"rotated" | "lost"`. Session `nextCursor` builds `after` from `query.sort`. Refresh returns `dataPayload`.
- Parser: `_WIP/readability/04-shared-list-query.md`. This note uses that parser. It does not rejudge it.

## Verdict

Refresh and logout match the `users/me` handler steps. The handler reads the body, rejects unknown keys, calls one function, and writes. The policy sits in `session.service.ts`. The SQL sequence sits in `shared/repository.ts`. Named builders in `auth.errors.ts` are the error table. That part is the copy target for a security endpoint.

The list handler is the copy target for a page. `readListQuery`, then one function, then `context.json(listPayload(page), 200)`. JWKS stays a non-envelope document, `context.json({ keys }, 200)`, as note 01 froze.

Two names are the miss. `classifyRefresh` returns `"ok" | "reused"` and throws the other outcomes. `rotateRefreshToken` returns a boolean after a batch that inserted a row even when the compare-and-set lost. A reader cannot see those outcomes in the types.

No client-facing bug. The D1 batch cannot roll back a 0-row update. The caller revokes the session after a loss, which is the containment. Do not split that batch.

## What was read

| File | Lines | Role |
| --- | --- | --- |
| `session.routes.ts` | 141 | `auth.refresh`, `auth.logout` |
| `session.service.ts` | 230 | `issueSession`, `refreshSession`, `logoutSession` |
| `sessions.routes.ts` | 194 | list and revoke |
| `sessions.service.ts` | 169 | page query and revoke |
| `jwks.routes.ts` | 47 | public keys |
| `sweep.jobs.ts` | 44 | `auth.purgeExpiredSessions` |
| `shared/repository.ts` | 316 | session, identity, and email sequences |
| `shared/auth.errors.ts` | 97 | named `AppError` builders |
| `shared/auth.rate-limits.ts` | 57 | exchange, connect, refresh, logout policies |

Specs sampled: `refresh.spec.ts`, `logout.spec.ts`, `sessions.spec.ts`, `jwks.spec.ts`, `sweep.jobs.spec.ts`. Backend `session-lifecycle.service.ts` and `rotateRefreshToken` in `prisma-auth.repository.refresh-tokens.ts` were read for the rotation race only.

## The shape to copy

**Public token route.** `session.routes.ts`. No auth middleware. `captureRawJson`, unknown keys, one service call. Refresh returns the object envelope. Logout returns `noContent()`.

**Authenticated collection.** `sessions.routes.ts`. `requireAuth` on the path. List calls `readListQuery` with an allowlist in the route file, then one service call, then `listPayload`. Revoke calls one service call and maps `false` to `404`.

**Issuance.** `issueSession` is the only place a session row and a refresh token are created. OIDC already calls it. The OIDC note must not grow a second issuer.

**Sweep.** `sweep.jobs.ts` matches the idempotency sweep. `defineJob`, clock from the dependencies, one delete, one log. The jobs pass should not restyle it.

The one-letter file split is the map. `session.*` is the caller's refresh token. `sessions.*` is the authenticated list. Do not rename those files in a taste edit. The import churn hides the diff. Do not add a third session file for one helper.

## Hard to read

### 1. `classifyRefresh` hides four outcomes

The function returns `"ok" | "reused"`. Deleted, suspended, revoked, and expired throw inside it. `refreshSession` only branches on `"reused"`. The other results are invisible at the call.

Mobile habit: one value, every arm named. Proposed edit, same checks, same errors, same order:

```ts
type RefreshDecision =
  | Readonly<{ kind: "ok" }>
  | Readonly<{ kind: "reused" }>
  | Readonly<{ kind: "invalid" }>
  | Readonly<{ kind: "suspended" }>
  | Readonly<{ kind: "revoked" }>
  | Readonly<{ kind: "expired" }>;
```

Applied. `refreshSession` switches on `kind` and throws the existing builders: `refreshTokenInvalid`, `userSuspended`, `sessionRevoked`, `refreshTokenExpired`, `refreshTokenReused`. `default` assigns the value to `never` and throws `new Error`. `@typescript-eslint/only-throw-error` rejects a thrown `never`.

### 2. `rotateRefreshToken` returns `false` after it has written

The batch updates the current token where `revokedAt` and `replacedById` are null, inserts the replacement, and updates the session. D1 applies the whole batch. A 0-row update is not a failure, so the insert is stored even when the compare-and-set lost. The function then returns `readChangeCount(results[0]) === 1`.

`refreshSession` treats `false` as reuse and calls `revokeSessionAndTokens`. That revoke is what contains the race. The boolean does not say a row was inserted.

Backend `rotateRefreshToken` inserts inside an interactive transaction and throws when `updateMany` count is not 1, so the insert rolls back, and the caller revokes after that. D1 has no interactive transaction across statements. The batch plus the later revoke is the Workers shape. Do not split the three statements into separate awaits.

Applied, same SQL and same caller revoke: return `"rotated" | "lost"`. One comment above the batch states that `"lost"` may already have inserted the replacement, and the caller must revoke. A comment above `issueAccessToken` in `refreshSession` states why the access token is signed before the batch: a thrown batch rolls back, so the caller's refresh token is still usable. The caller checks `rotation === "lost"`. A switch on that pair pushed `refreshSession` to complexity 13. The limit is 12.

### 3. The list cursor is a fixed pair

`listUserSessions` encodes `nextCursor` with `createdAt` and `id` on every page. The sort for an `id`-only request is just `id`, because the tie-breaker is `id`. `decodeCursorV1` allows the extra `createdAt` because that field is on the allowlist. The cursor still works. A third sort field would be required by the decoder and missing from this object.

Applied. `cursorAfter` builds `after` from `query.sort` and the last row. `createdAt` uses `toISOString()`. `id` uses the string. An `id`-only cursor stops carrying `createdAt`. The default sort still includes the `id` tie-breaker, so those cursors still carry both. Old cursors still decode. `nextCursor` stays an opaque string. No response field moves.

### 4. Refresh still builds the envelope by hand

Applied. `session.routes.ts` returns `context.json(dataPayload(result), 200)`. Note 03 added the helper. This edit does not add it.

## Correct and should stay

- `auth.errors.ts` is the error table for refresh and for OIDC. Builders stay one function per code. OIDC notes call them. They do not move the table.
- `auth.rate-limits.ts` is the policy table. Four named limits. The route file does not pick a number. Leave the explicit fields. A loop over the keys would hide the paths.
- Logout hashes the token, loads the row, and revokes that session. An unknown hash is `AUTH_REFRESH_TOKEN_INVALID`. An expired row still revokes. Refresh rejects expiry before revoke. Those are different policies. Do not make logout share `classifyRefresh`.
- Revoke loads the session and returns `false` when the id is missing or belongs to someone else. The handler throws `404` for both. The route schema is `z.string()`, and the handler rejects a non-UUID with `VALIDATION_FAILED`. The OpenAPI document stays a string. Moving `z.uuid()` into the route schema would change the published contract. Leave the handler check.
- `statusFor` prefers `revoked` over `expired`. The list description says revoked sessions stay listed. Leave the order.
- `createSessionWithToken` revokes the previous active device session in the same batch as the insert, and that revoke clears the push token columns. One device key, one active session. Leave the batch.
- `issueSession` signs, then `createSessionWithToken`. A failed batch returns no token to the client. OIDC depends on this order. Do not reverse it.
- `shared/repository.ts` also holds `findIdentity`, `insertIdentity`, `markEmailVerified`, and `consumeEmailVerificationToken`. Email verification returns a string union, not a `kind` object. The email-verification note owns that function. Do not split the file in this pass.
- `TRUE = sql\`1 = 1\`` is the empty clause. `mergeWhereClauses` uses reference equality against that value. Leave the sentinel. A structural SQL compare would be a different predicate.
- The sweep deletes expired sessions through `purgeExpiredSessions`. Clock comes from the job dependencies. Leave it.

## Bugs

None that change a response the tests describe.

Residual, not a fix in this program: a crash after a lost `rotateRefreshToken` batch and before `revokeSessionAndTokens` leaves the replacement row. The plaintext refresh token was never returned. Do not treat that window as a reason to unpack the batch.

## Design question

Rotation, reuse, and revocation stay in this feature. Platform auth keeps signing and the key ring. `src/shared/list-query` keeps parsing. The session service keeps the column map `FIELD_OPS` and the page size. Those are the product rules.

## Edit this acceptance allows

When this note is accepted, and not before:

1. `RefreshDecision` and the switch in `refreshSession`.
2. `"rotated" | "lost"` from `rotateRefreshToken`, plus the two comments in §2.
3. `nextCursor` `after` built from `query.sort`.
4. The refresh success return uses `dataPayload` only after note 03 has added it.

No change to status codes, error codes, token hashing, the batch statements, or the list JSON fields.

## Verification

`npx vitest run src/features/auth/sessions/refresh.spec.ts src/features/auth/sessions/logout.spec.ts src/features/auth/sessions/sessions.spec.ts src/features/auth/sessions/jwks.spec.ts src/features/auth/sessions/sweep.jobs.spec.ts`

27 tests passed. `npx eslint` and `npx prettier --check` on `session.service.ts`, `session.routes.ts`, `sessions.service.ts`, and `shared/repository.ts` passed.

## Next

`_WIP/readability/06-features-auth-oidc.md`. Exchange may switch to `dataPayload`. Its single `GOOGLE` arm cannot use a `switch` whose only case is always true.
