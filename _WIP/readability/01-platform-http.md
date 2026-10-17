# Section note: `src/platform/http`

- Status: Accepted. The two edits below are applied.
- Date: 2026-10-15
- Scope: envelope, problem details, validation, request id, logging, OpenAPI metadata, the list-query adapter, and `createApp`. Idempotency is the next note.
- Ruler: `_WIP/2026-10-15_cf-core-kit-readability-proposal.md`
- Code changes: `fieldOf` reads the key directly. `createApp` names the pipeline steps that live outside it.

## Verdict

This package is already the core the mobile habit asks for. `problemResponse` is the only problem writer. `openApiValidationHook` is the request validator for contract routes. `noContent` is the 204 return. `readListQuery` is the one list parser. Handlers throw `AppError`. They do not build problem JSON.

The miss is the success envelope on OpenAPI JSON routes. `data()`, `list()`, and `created()` return a bare `Response`. A `RouteHandler` whose route declares JSON content must return Hono's `TypedResponse`, which is what `context.json` produces (`@hono/zod-openapi` `RouteHandlerResponse`). Six handlers therefore inline `{ data: ... }`. Lists already avoid that by calling `listPayload` and passing the result to `context.json`. Object responses have no twin.

The dialect this note freezes:

| Response                                                  | Return                                  |
| --------------------------------------------------------- | --------------------------------------- |
| Contract object, HTTP 200                                 | `context.json(dataPayload(value), 200)` |
| Contract list, HTTP 200                                   | `context.json(listPayload(value), 200)` |
| Empty 204                                                 | `noContent()`                           |
| Document that is not the contract envelope (health, JWKS) | `context.json(document, status)`        |

`dataPayload` lands with the `users/me` note, next to the first two call sites. It does not land in this section's edit. An export with only a unit test is a speculative helper. `jsonData(context, value)` stays unbuilt. It would hide the `context.json` return that the route type requires, and this note did not prove a wrapper still typechecks.

`data()`, `list()`, and `created()` stay. `src/app.ts` `/`, the HTTP tests, and the idempotency specs are plain Hono handlers, not `RouteHandler`s. Idempotency stores `context.res` after `next()`, so both return styles replay the same body. Deleting the `Response` helpers to force one function would fight that.

No bug in this slice.

## What was read

Production, judged:

| File                 | Lines | Role                                                  |
| -------------------- | ----- | ----------------------------------------------------- |
| `app.ts`             | 22    | `OpenAPIHono`, request id, not-found, onError         |
| `envelope.ts`        | 48    | `data`, `listPayload`, `list`, `created`, `noContent` |
| `problem.ts`         | 118   | RFC7807 response                                      |
| `validation.ts`      | 84    | unknown keys, zod issues, `decode`, `readJson`        |
| `request-id.ts`      | 41    | inbound id normalization and echo                     |
| `request-logging.ts` | 90    | one access line, one error line                       |
| `raw-body.ts`        | 20    | raw JSON capture for unknown keys                     |
| `openapi.ts`         | 124   | operation metadata, emit mutations, validation hook   |
| `list-query.ts`      | 123   | Hono query string to `parseListQuery`                 |
| `types.ts`           | 13    | `AppEnv`                                              |

Tests read for behavior, not taste: `app.spec.ts`, `envelope.spec.ts`, `problem.spec.ts`, `validation.spec.ts`, `request-id.spec.ts`, `request-logging.spec.ts`, `observability.spec.ts`, `list-query.spec.ts`.

Idempotency was opened only far enough to see the split. `idempotency.ts` is 164 lines, `idempotency.core.ts` 249, `idempotency.service.ts` 292, `idempotency.jobs.ts` 41, plus their specs. Not judged. One fact used below: `idempotent` replays from `context.res` after `next()`. The 201-to-200 replay downgrade is documented family behavior in `docs/exec-plans/completed/2026-10-10_idempotency.md`. It is not a finding here.

Call sites checked, not reviewed: the six `context.json({ data })` handlers, `sessions.routes.ts` `listPayload`, health, JWKS, and `src/app.ts`.

## Hard to read

### 1. Object success has no payload twin

`listPayload` returns `{ data, meta }`. The sessions list handler passes that object to `context.json`. Object handlers build the wrapper themselves:

- `session.routes.ts` refresh
- `oidc.routes.ts` exchange
- `me.routes.ts` get and patch
- `profile-image.handlers.ts` upload and url

`data()` cannot replace those lines. It returns `Response`, and a JSON `RouteHandler` will not accept that return. `list()` has the same shape and has no feature caller for the same reason.

Mobile habit: one helper owns the repeated response shape. The helper that fits this type constraint is the object twin of `listPayload`:

```ts
export function dataPayload<T>(payload: T): { data: T } {
  return { data: payload };
}
```

Feature notes switch their own handlers to `return context.json(dataPayload(value), 200)`. This note does not switch them. Health and JWKS do not use `dataPayload`. Their bodies are not the contract envelope. ADR-0003's "features never construct raw data responses" is this line, not a ban on `context.json`.

### 2. `fieldOf` copies the object to read one key

`validation.ts` `fieldOf` builds a new record with `Object.entries`, then returns `record[key]`. The only caller is `me.routes.ts`, which reads `profile` off the raw patch body before a second `rejectUnknownKeys`.

For a JSON object the copy and a direct read see the same own keys. The copy is the line that makes the reader look for a transform that is not there.

Proposed edit, same keys for JSON bodies:

```ts
export function fieldOf(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return (value as Record<string, unknown>)[key];
}
```

### 3. `createApp` shows three of the pipeline steps

`createApp` registers request id, `notFound`, and `onError`. `src/app.ts` registers `requestLogging()` after that. Auth, idempotency, and `captureRawJson` are per route. ADR-0003 lists the full order in one sentence. The function does not.

The statements are already one step per line. Do not fold logging into `createApp`. Registration order is the behavior. Move it and the relative order against routes registered inside `createApp` changes.

Proposed edit: one comment on `createApp` that names the steps which live outside it. Logging in `src/app.ts`. Auth, idempotency, and raw-body capture on the route. The validation hook is the `defaultHook` already passed above the comment.

## Correct and should stay

- `problemResponse` maps `AppError` to a problem and every other throw to 500 `INTERNAL` with no `detail`. `problem.spec.ts` pins the secret-detail case. Do not log or render `Error.message` for unknown throws. `logRequestError` already records that message on the server side.
- Empty `AppError.message` omits `detail`. The constructor defaults `message` to `""`. A condition on `message.length === 0` is the omit switch. Leave it.
- `problemResponse` sets `X-Request-Id` on the new error `Response`. `requestIdMiddleware` sets it on `context.res` after `next()`. Both stay. The error response is a different object.
- `requestLogging` uses `Date.now()` for duration. The wall-clock smell scan covers `src/features/**` only. This duration is not domain time. `logRequestError` passes duration `0` because `onError` has no start time. Do not add a second clock read to invent one.
- `requestLogging` returns when `context.error` is set, so a failure is one line from `logRequestError`, not a second access line. `observability.spec.ts` owns that claim.
- `captureRawJson` swallows a parse failure and stores `undefined`. `rejectUnknownKeys` then sees no keys. The validation hook reports the bad body. Rethrowing would skip that `VALIDATION_FAILED` shape.
- `rejectUnknownKeys` returns on non-objects. Arrays and scalars have no JSON object keys. Zod has already rejected them on these routes. `z.strictObject` is the wrong fix: `docs/exec-plans/completed/2026-10-11_users-me.md` records that it emits `additionalProperties: false` and drifts the contract. Unknown-key policy stays a call beside the raw body. The allowed key list stays in the feature. That list is the route's policy.
- `decode` and `readJson` stay for plain Hono routes and their tests. Contract handlers do not call them. They read `context.req.valid("json")`. A second parse on an OpenAPI route fights the hook.
- `readListQuery` stays in this package. Bracket keys, unknown params, and the throw to `AppError` are the Hono adapter. `src/shared/list-query` remains its own note before sessions. Do not inline `parseListQuery` here, and do not move the query-string grammar into the feature.
- `openapi.ts` keeps emit mutations and the request hook together. Both are the contract pipeline. The emit caller is `tools/contract/emit.entry.ts`. A second file would split one pipeline.
- `created()` stays for a future 201 route and for the idempotency specs. No current feature route returns 201. Do not add a `context.json` twin until a route declares 201.

## Bugs

None in the files judged above.

## Design question

The repeated mechanic is the `{ data }` wrapper. It belongs beside `listPayload`. The `users/me` note adds `dataPayload` and switches get and patch. Later feature notes copy that return. They do not add a third wrapper.

What stays in the feature: the allowed-key list, the choice between object, list, empty, and non-envelope document, and the `AppError` it throws. `problemResponse` remains the only translator from that error to JSON.

## Edit this acceptance allows

Inside this section only:

1. Replace the `fieldOf` copy with the direct read above.
2. Add the `createApp` comment described above.

No feature call-site edits. No new envelope export. No idempotency edit.

## Verification

`npx vitest run src/platform/http/validation.spec.ts src/platform/http/app.spec.ts src/features/users/me/me.spec.ts`

24 tests passed. `me.spec.ts` is the only `fieldOf` caller. The `createApp` comment has no behavior test. `npx eslint` and `npx prettier --check` on the two edited files passed.

## Next

Idempotency note: `_WIP/readability/02-platform-http-idempotency.md`.
