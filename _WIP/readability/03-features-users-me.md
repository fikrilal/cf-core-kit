# Section note: `src/features/users/me`

- Status: Accepted. The three edits below are applied.
- Date: 2026-10-15
- Scope: the `users.me.get` and `users.me.patch` slice. This is the copy target for an endpoint slice.
- Ruler: `_WIP/2026-10-15_cf-core-kit-readability-proposal.md`
- Code changes: `dataPayload` wraps the two me returns. `loadMe` maps `provider` through `Record<OidcProvider, AuthMethod>`. `captureRawJson` sits behind `onlyMethod("PATCH", ...)`.

## Verdict

This slice is the shape later endpoint handlers should copy. The route file holds the OpenAPI routes, the operation metadata, the handlers, the one policy function, and `registerMeRoutes`. `me.ts` is the SQL sequence. `payload.ts` is the wire map. There is no service. ADR-0001 agrees: `sanitizeProfile` is the policy, and it is already a named function. A `me.service.ts` that only called `updateMeProfile` would be a pass-through.

Two habits are not finished. The success return still builds `{ data }` by hand, which note 01 already froze as `dataPayload`. `loadMe` selects `provider` and then ignores it, so a row count becomes the auth method. Neither is a behavior bug on today's data.

`undefined` for a missing live user stays. One miss does not need a `kind`. Multi-outcome repositories, starting with profile-image, keep their kinds. Do not copy a kind back into this slice to make the files look alike.

## What was read

| File | Lines | Role |
| --- | --- | --- |
| `me.routes.ts` | 191 | routes, metadata, `sanitizeProfile`, handlers, register |
| `me.ts` | 93 | `loadMe`, `updateMeProfile` |
| `payload.ts` | 32 | `toMePayload`, `toAuthUserPayload` |
| `users.routes.ts` | 36 | mounts this slice with the app clock |
| `index.ts` | 11 | the feature surface auth is allowed to import |
| `me.spec.ts` | 330 | envelope, deleted user, trim, null clear, unknown keys, idempotency |

`OidcProvider` is only `"GOOGLE"` (`src/platform/db/schema.ts`). Account-deletion writes `deletionRequestedAt` and `deletionScheduledFor` together. Those two facts bound the findings below.

## The shape to copy

A reader who has learned this slice should expect the next endpoint slice to do the same steps.

**Register.** One `register*` function. Clock comes from the caller, defaulting to `systemClock`. Middleware for a path is listed in `app.use` before `app.openapi`. The scope key is the only idempotency policy on the route.

**Handler, read.** `requirePrincipal`, one repository call, `undefined` becomes `401 UNAUTHORIZED`, then the success return.

**Handler, write.** `requirePrincipal`, raw body plus `context.req.valid("json")`, `rejectUnknownKeys` for the route's own key list, one policy function, one repository call, the same missing-user throw, the same success return.

**Repository.** One read, or one update plus the read that builds the response. It returns the view or `undefined`. It does not throw `AppError`. It takes `Clock.now()` from the handler when it writes.

**Mapper.** `toMePayload` sits beside the repository, not inside the SQL. A one-field rename can stay inline. This mapper exists because the view and the wire DTO are different types.

**Operation metadata.** The `errorCodes` array is the handler's throws plus the middleware throws. Get lists `UNAUTHORIZED` and `INTERNAL`. Patch adds `VALIDATION_FAILED`, `IDEMPOTENCY_IN_PROGRESS`, and `CONFLICT`.

What this slice does not teach: a service file, a `kind` for a single miss, a second handler file, or a platform helper that only this route needs.

## Hard to read

### 1. The success return is still the inline envelope

Both handlers end in `context.json({ data: toMePayload(me) }, 200)`. Note 01 froze the object dialect as `context.json(dataPayload(value), 200)` and left the helper for this note, because these are the first two call sites.

Proposed edit, same status and body: add `dataPayload` in `src/platform/http/envelope.ts`, cover it in `envelope.spec.ts`, and switch these two returns. No other handler moves in this edit. Sessions, OIDC, and profile-image keep the inline object until their own notes.

### 2. `loadMe` selects `provider` and does not read it

```ts
const authMethods: AuthMethod[] = [];
if (identities.length > 0) {
  authMethods.push("GOOGLE");
}
```

Any identity row becomes `GOOGLE`, including a future provider the union does not have yet. The column is loaded for nothing. `PASSWORD` is on the wire enum and is not a branch here. ADR-0006 descoped password, so the absence is right. The silence about `provider` is not.

Mobile habit: the value that picks the outcome is named. The accepted draft showed a `switch` with a `never` default. `OidcProvider` has one member, so `case "GOOGLE"` is always true and `@typescript-eslint/no-unnecessary-condition` rejects it. A suppression was not added. Applied edit, same result for every row that can exist today:

```ts
const authMethodByProvider: Record<OidcProvider, AuthMethod> = {
  GOOGLE: "GOOGLE",
};

const authMethods: AuthMethod[] = [];

for (const identity of identities) {
  authMethods.push(authMethodByProvider[identity.provider]);
}
```

The record fails the build when `OIDC_PROVIDERS` grows and this map is not updated. It does not throw on current rows. `PASSWORD` stays off the map. ADR-0006 descoped it.

### 3. `captureRawJson` is mounted on the GET

`/v1/me` is both methods. `onlyMethod("PATCH", idempotent(...))` exists because the idempotency middleware rejects a non-write with `500`. `captureRawJson()` is mounted on the same path with no method guard. GET does not read `rawJson`. The parse failure is swallowed, so the response stays correct. The two write-only middlewares do not look like the same decision.

Proposed edit: `onlyMethod("PATCH", captureRawJson())`. GET stops cloning a body it never uses. PATCH still rejects unknown keys from the raw body. No status or body change.

`onlyMethod` stays in this file. One route pair uses it. A platform helper waits for a second caller.

## Correct and should stay

- `sanitizeProfile` stays in the route file. It trims, rejects a whitespace-only value with `profile.<field>`, and keeps `null` as a clear. The zod schema already rejects an empty profile and an over-long string. The trim is the rule zod does not express. One `AppError` is small enough to stay at the throw. Do not add an errors file for it.
- `updateMeProfile` writes `updatedAt` and only the fields the patch contains, with `status <> DELETED`, then calls `loadMe`. The reload is how the handler returns the fresh view. D1 does not hand that view back from the update. A user deleted between the statements becomes `undefined`, then `401`. That is the same answer as a deleted read.
- `accountDeletion` is set only when both timestamps are present. The deletion repository writes and clears those two columns together. A half-written pair would hide as `null`. That pair is the deletion note's question if a write can split them. It is not a second shape for `me`.
- `toMePayload` copies `roles` and `authMethods` into arrays. The view holds `readonly` arrays. The contract type does not. Leave the copy.
- `toAuthUserPayload` maps `emailVerifiedAt` to `emailVerified` for the session response. Auth imports it through `src/features/users/index.ts`. It is not part of the me handler. The sessions note reads it. This note does not move it.
- Unknown keys stay as `rejectUnknownKeys` on the raw body. Note 01 already recorded why `z.strictObject` is the wrong tool.
- `users.routes.ts` passes the clock and does not pass a rate limiter into this slice. Me has no rate-limit policy. Do not add one for symmetry with profile-image.

## Bugs

None. A stored identity is `GOOGLE`. Both deletion timestamps are written as a pair. The inline `{ data }` matches the envelope tests.

## Design question

Nothing in this slice should move into platform except `dataPayload`, which note 01 already placed here. The allowed key list, the trim rule, and the scope key `users.me.patch` are the product policy. They stay in the route file.

## Edit this acceptance allows

When this note is accepted, and not before:

1. `dataPayload` plus the two me returns.
2. The `provider` map in `loadMe`. The one-member union cannot use the drafted `switch`.
3. `captureRawJson` behind `onlyMethod("PATCH", ...)`.

No change to status codes, error codes, the wire DTO, or the update statement.

## Verification

`npx vitest run src/platform/http/envelope.spec.ts src/features/users/me/me.spec.ts`

19 tests passed. `npx eslint` and `npx prettier --check` on `envelope.ts`, `envelope.spec.ts`, `me.ts`, and `me.routes.ts` passed.

## Next

`_WIP/readability/04-shared-list-query.md` has no production edit. The next note with edits is `_WIP/readability/05-features-auth-sessions.md`. Its refresh `dataPayload` switch is unblocked.
