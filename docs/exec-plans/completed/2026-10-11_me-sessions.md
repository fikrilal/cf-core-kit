# users/me/sessions: list and revoke (task 3.7)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0002, ADR-0003; roadmap task 3.7

## Objective

`users.me.sessions.list` (GET /v1/me/sessions) and `users.me.sessions.revoke` (POST /v1/me/sessions/{sessionId}/revoke) are mounted, contract-green, and tested. The list is the first real consumer of the shared list-query pipeline (cursor pagination, sort allowlist, limit bounds) and of the cursor-after algebra; revoke reuses the auth feature's session-family revocation and is idempotent.

## Behavior reference (backend-core-kit recon)

- List: per-endpoint options `defaultLimit 25 / maxLimit 100`; sort allowed `createdAt` (datetime) and `id` (uuid), default `-createdAt`, tie-breaker `id desc` appended; cursor = the shared v1 codec over the normalized sort + last row; unknown/duplicate/unsupported sort, bad cursor, limit bounds, and unknown query params → 400 `VALIDATION_FAILED`. Query selects all sessions of the user (active, revoked, expired — no status filter), `take limit + 1`, `meta` = `{limit, hasMore, nextCursor?}` (no total). DTO per row: nullable deviceId/deviceName/ip/userAgent (UA max 512 in the schema), `lastSeenAt`/`createdAt`/`expiresAt` ISO, `revokedAt` ISO or null, `current = id === principal.sessionId`, `status` precedence: `revokedAt != null` → `revoked`, else `expiresAt <= now` → `expired`, else `active`.
- Revoke: guard → UUID check (non-UUID → 400 `VALIDATION_FAILED`, though the contract declares the path param as a plain string, so the format check lives in the service) → lookup by **id AND userId** (unknown id and foreign session are indistinguishable) → not found → 404 `NOT_FOUND` ("Session not found"); already revoked or expired → still 204 (idempotent, re-clears activeKey); no special case for the current session (its access token stays valid until `exp`, its refresh tokens die). Revocation touches the session (`revokedAt` if null, `activeKey` null) and all its refresh tokens — exactly the auth feature's existing `revokeSessionAndTokens`.

## Constraints

- Session logic (list + revoke) lives in the auth feature and is exported through `src/features/auth/index.ts`; the users routes consume it through that barrel (boundary zones enforce the pair).
- The feature maps the shared list-query algebra to Drizzle conditions itself (first consumer — no speculative platform adapter); the response cursor is re-encoded with the shared `encodeCursorV1` from the last row.
- The 404 body stays dialect-shaped: `code: NOT_FOUND`, title `Not Found`, `traceId` = request id, no existence leak for foreign sessions.
- Manifest moves `users.me.sessions.list` and `users.me.sessions.revoke` to `implemented` (implemented surface 13 operations); parity + Spectral green.

## Impact Areas

- API / contract: two operations mounted; Auth: the first list surface and the session-revocation route; Budget: revoke writes 2 rows (session + tokens); list is read-only and capped at 101 rows fetched.

## Acceptance Criteria

1. List: default sort `-createdAt` with id tie-breaker; pagination with `limit`/`hasMore`/`nextCursor` and a working cursor round-trip; `current` true only for the caller's session; status precedence incl. revoked-wins-over-expired; foreign users' sessions excluded; 400s for limit bounds, unsupported sort, malformed cursor, unknown params.
2. Revoke: 204; refresh tokens of that session all revoked (a refresh then returns `AUTH_SESSION_REVOKED`); re-revoke 204; unknown or foreign → 404 `NOT_FOUND`; non-UUID → 400 `VALIDATION_FAILED`; revoking the current session is allowed and the caller's access token still works.
3. Emitted spec matches the snapshot (list parameters incl. limit/sort/cursor, `MeSessionsListEnvelopeDto`, 204 revoke); parity + Spectral + `npm run verify:ci` green.

## Steps

- [x] Contract DTOs (MeSessionDto, MeSessionsListEnvelopeDto) + auth-side sessions service (list with Drizzle mapping + revoke) + auth barrel
- [x] Users routes + metadata + emitter; manifest move; emit
- [x] Tests (list matrix incl. cursor round-trip; revoke matrix) ; verify + bookkeeping

## Decision Log

- 2026-10-11: the path param schema stays a plain string (contract shape), with the UUID check in the service. -> declaring `format: uuid` would drift from the snapshot's parameter schema, which the parity gate compares structurally
- 2026-10-11: sessions logic stays in the auth feature even though the routes are `/v1/me/*`. -> session semantics (family revocation, status derivation) are auth domain; the users feature composes through the exported surface

## Verification

```bash
npm run verify:ci   # full profile green (11 steps): 275 vitest tests across 42 files, 60 script
                    # fixtures, budget, drift, parity ok (13 implemented operations), spectral ok,
                    # build ok
# matrix: list statuses (revoked wins over expired, current flag on the token's sid), foreign
#   sessions excluded, 401 without token; cursor round-trip over 5 seeded sessions (limit/hasMore
#   /nextCursor, no duplicates); id sort; 400s for limit 101/0, unsupported sort, malformed
#   cursor, unknown params; revoke 204 + session and refresh tokens revoked (DB), re-revoke 204,
#   revoking the current session leaves the access token usable, 404 for unknown/foreign, 400
#   non-UUID, 401 no token; cross-feature chain (users revoke -> auth refresh 401
#   AUTH_SESSION_REVOKED) in test/integration/session-revoke.spec.ts
```

## Completion Notes

Both operations are mounted, contract-green (13 implemented operations), and tested. Two
refinements worth recording: the list's documented query parameters come from **operation
metadata** (`applyOperationParameters`) instead of a route-level query schema — zod-validating
the query at the route would double-parse and would reject `limit=""`, which the shared pipeline
deliberately treats as the default, so the pipe stays the single parser and the doc stays
exact. The shared cursor-after algebra is mapped to Drizzle inside the auth feature (first
consumer; promotion to the platform waits for a second). `listPayload` became generic so typed
handlers can keep using the platform envelope shape. Revocation reuses the existing
`revokeSessionAndTokens` (idempotent re-revoke, current session allowed, token family dies);
unknown and foreign sessions return the same 404. The cross-feature chain test lives in
`test/integration/` because feature-directory specs sit inside the ESLint boundary zones —
cross-feature composition belongs to a composition-level test, not to a feature spec.
