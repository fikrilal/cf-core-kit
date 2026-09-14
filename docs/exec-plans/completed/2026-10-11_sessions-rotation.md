# Session lifecycle: rotation, reuse detection, logout (task 3.3)

- Status: completed
- Owner: fikrilal
- Risk: high
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0006, ADR-0002; roadmap task 3.3

## Objective

`auth.refresh` and `auth.logout` are mounted, contract-green, and tested: single-use rotation (old token revoked + `replacedById` lineage), reuse detection revoking the whole session (token family), logout revoking the session and every token it owns, suspension/expiry/revocation ordering, and `lastSeenAt` maintenance. Non-2xx refresh responses never consume the caller's token.

## Behavior reference (mirror exactly)

- Failure order: unknown hash → 401 `AUTH_REFRESH_TOKEN_INVALID`; DELETED user → 401 `AUTH_INVALID_CREDENTIALS`; SUSPENDED → 403 `AUTH_USER_SUSPENDED`; session revoked → 401 `AUTH_SESSION_REVOKED`; expired (token or session) → 401 `AUTH_REFRESH_TOKEN_EXPIRED`; already rotated/revoked → 401 `AUTH_REFRESH_TOKEN_REUSED` **and revoke the entire session + all its refresh tokens** (iterate to the family head).
- Rotation: mint the access token first; create the replacement token with the **same session** and the same `expiresAt`; revoke the old row with a conditional update (`revokedAt IS NULL AND replacedById IS NULL`); a lost race is treated as reuse (family revocation). Update `lastSeenAt`.
- Refresh response: 200 `{ data: { user: AuthUserDto, accessToken, refreshToken } }` — `authMethods` omitted in refresh responses.
- Logout: unknown hash → 401 `AUTH_REFRESH_TOKEN_INVALID`; success revokes the session (clears `activeKey`) and all its refresh tokens → 204 (idempotent for the same token by construction: revoked token presented again is a session-revoked 401).
- Reuse revokes only the affected session, never user-wide.

## Constraints

- Rotation writes go through `runBatch` (atomic multi-statement): token revocation + replacement insert + session touch in one D1 batch (≤ 2–3 rows per write request budget).
- Time comes from the injected `Clock`; TTLs from config (tests set 1–2s TTLs through the same config seam rather than sleeping).
- The service path is injectable (verifier/mint + repositories) so the reuse/order/race matrix is testable without network; the pool tests use real D1.
- Manifest: move `auth.refresh`, `auth.logout` to `implemented` in the same change; emitted spec regenerates.

## Impact Areas

- API / contract: two operations mounted; Auth: session security semantics; Budget: ≤ 3 rows written per refresh (conditional update + insert + session touch), 1 batch.

## Acceptance Criteria

1. Behavior matrix in the Workers pool: happy rotation (old token then fails as REUSED and revokes the family; new token still works), expired token, revoked session, suspended user, deleted user, unknown token, logout then refresh → SESSION_REVOKED, concurrent double-refresh (one winner; loser triggers family revocation) — documented as intended strictness.
2. `lastSeenAt` advances on refresh; session `expiresAt` never extends.
3. Parity + spectral green with both ops declared; `npm run verify` green; roadmap 3.3 checked.

## Steps

- [x] Session lifecycle service (refresh/logout) + repository updates with conditional rotation + batch
- [x] Routes + DTO wiring; error codes already present; manifest/spec updates
- [x] Tests (matrix incl. race and logout semantics); verify + bookkeeping

## Decision Log

- 2026-10-11: race loser triggers family revocation, mirroring backend. -> single-use strictness beats convenience; clients retry from the winning token
- 2026-10-11: access token minted before rotation commits. -> a failed rotation must never consume the caller's token

## Verification

```bash
npm run verify:ci   # full profile green (11 steps): format, lint, typecheck, typecheck:cfkit,
                    # vitest (229 tests across 36 files), script fixtures (55), budget
                    # (1159.91 KiB), drift, contract:check (parity ok), contract:lint, build
npm run contract:emit   # docs/openapi/openapi.yaml now carries all four auth operations (10,071 bytes)
# behavior matrix (deterministic: fixedClock(TEST_TOKEN_INSTANT) injected into the routes):
#   rotation (payload, verifiable access token, replacement lineage, same expiry, lastSeenAt
#   advance); reuse detection revoking the session family (active tokens 0, rotated token then
#   AUTH_SESSION_REVOKED); failure order (unknown, expired token/session, revoked session,
#   suspended, deleted); concurrent double-refresh lets exactly one rotation win; logout
#   revokes session + tokens, is idempotent, validates the payload
```

## Completion Notes

`auth.refresh` and `auth.logout` are mounted, contract-green, and tested. Rotation is a single
D1 batch (conditional revoke of the presented token, insert of the replacement, session touch)
whose matched-row count decides the outcome: a lost race or a replayed token revokes the whole
session family and returns 401 `AUTH_REFRESH_TOKEN_REUSED`; the replacement keeps the original
token expiry and the session never extends. Failure order mirrors the family (invalid →
suspended → session-revoked → expired → reused), with deleted accounts resolving to the
declared 401 `AUTH_REFRESH_TOKEN_INVALID` per the review-round vocabulary rule. Logout revokes
the session and every token it owns and is idempotent for the same token. The access token is
minted before rotation commits, so a failed refresh never consumes the caller's token. Session
updates advance `lastSeenAt` and refresh ip/userAgent only when provided.
