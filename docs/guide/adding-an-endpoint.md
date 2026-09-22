# Adding an endpoint

Endpoints are contract-first: the pinned snapshot in `contracts/backend.openapi.yaml` declares
operations before they are implemented, and `tools/parity/coverage.json` classifies each one as
`implemented` or `pending`. You implement a **pending** operation — the scaffold refuses to
invent surface the contract does not declare.

```bash
# pick a pending operation (the smoke does this automatically for CI)
node -e "console.log(require('./tools/parity/coverage.json').pending.join('\n'))"

npm run cfkit -- scaffold endpoint users.me.pushToken.revoke
#   create src/features/users/me-push-token-revoke.routes.ts
#   create src/features/users/me-push-token-revoke.routes.spec.ts
#   edit   src/app.ts                      (import + register call)
#   edit   tools/contract/emit.entry.ts    (import + call + operations)
#   manifest users.me.pushToken.revoke: pending -> implemented
#   (the scaffold then runs contract:emit, so docs/openapi/openapi.yaml matches)
```

Then:

1. Replace the `TODO` markers: implement the handler's real semantics (the stub answers 204)
   and turn the generated spec into real behaviour tests.
2. `npm run verify:ci` — the contract gate compares the emitted operation with the snapshot.

Refusals (each names the fix):

- unknown operation, or one already `implemented`;
- anything that is not a simple 204 operation (single 204 response, no body, no parameters) —
  declare its DTOs and route by hand, or extend the scaffold;
- an error code missing from `src/shared/error-codes.ts`;
- a tag missing from the emitter's tag registry;
- a feature directory that does not exist yet (`scaffold feature` first);
- anchors missing from `src/app.ts` or the emitter (nothing is written when an anchor check
  fails).

Removal is marker-checked — it refuses routes it cannot prove it generated:

```bash
npm run cfkit -- remove endpoint users.me.pushToken.revoke
```
