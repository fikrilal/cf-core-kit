# users.me.pushToken.upsert + revoke (endpoints 3-4 of 10)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0007 (platform service policy), ADR-0008 (feature boundaries); goal: all auth + users endpoints

## Objective

Mount `users.me.pushToken.upsert` (PUT /v1/me/push-token) and `users.me.pushToken.revoke`
(DELETE /v1/me/push-token) with the family semantics: session-scoped FCM token storage with global
uniqueness and ownership transfer, a 501 `AUTH_PUSH_NOT_CONFIGURED` gate on upsert while no push
provider is configured, and liveness rules (upsert requires a live session; revoke is a plain
idempotent clear).

## Behavior reference (backend-core-kit)

- Upsert: bearer; DTO `{ platform: ANDROID|IOS|WEB (trim+uppercase), token: trimmed, 1..2048 }`;
  `204`; **`501 AUTH_PUSH_NOT_CONFIGURED` raised in the controller before any work** when the push
  port is disabled; `401 UNAUTHORIZED` for missing/deleted user or a caller session that is revoked
  or expired (the session is validated first, inside the write transaction); platform/token
  validation failures are `400 VALIDATION_FAILED`.
- Storage: `sessions` columns `push_platform`, `push_token` (globally unique), `push_token_updated_at`,
  `push_token_revoked_at`; upsert (a) validates+locks the caller session (`revokedAt is null and
expiresAt > now`, `session_not_found` otherwise), (b) clears the token from any other session
  holding it (ownership transfer for account switching) and stamps `pushTokenRevokedAt`, (c) sets
  the caller's platform/token/updatedAt with `pushTokenRevokedAt = null`. Re-upsert is idempotent.
- Revoke: bearer; `204`; clears the caller session's push fields with **no liveness check** and no
  count guard (idempotent even for revoked/unknown sessions); no body, no idempotency header, no
  rate limit.
- Session revoke/takeover also clear push fields (existing repository paths get the same treatment).
- Later push sends (not in this scope) read the token from the session and clear it on
  `InvalidToken` with a token-guarded update.

## Design (free-tier mapping)

- Platform `src/platform/push/`: a `PushPort { isEnabled(); sendToToken() }` with a disabled default
  and config keys `PUSH_PROVIDER` (`FCM`), `FCM_*` credentials. This task only needs the port and
  `isEnabled`; the send path is documented as deferred until a product surface needs it
  (ADR-0007: land the port with the first consumer, keep the credentials optional).
- Schema: add the four session columns + a unique index on `push_token` (SQLite treats NULLs as
  distinct, so unlimited sessions may hold no token) + an index on `push_token_revoked_at` only if a
  query needs it (none today — recorded deviation from the family's extra index).
- Repository: `upsertSessionPushToken` as a guarded `db.batch` — token clear of other holders guarded
  by `push_token = <token> and id != <session>`, session validation via a guarded update of
  `push_token_updated_at` on the caller (count 0 → `session_not_found`), then the caller's set. D1 is
  single-writer per database, so the batch is the transaction; a token unique-race surfaces as a
  failed batch and is retried once by re-reading (the family retries serializable conflicts).
- Controller order is behavior: `isEnabled` gate (501) → principal → user exists/not deleted (401) →
  session-guarded upsert (401 on `session_not_found`) → 204. Revoke: principal → user check → clear → 204.

## Acceptance Criteria

1. With push disabled: upsert → `501 AUTH_PUSH_NOT_CONFIGURED` (before touching user/session state);
   revoke still works and answers `204`.
2. With a stub enabled port: upsert stores the trimmed/uppercased platform + token on the caller
   session, transfers the token from another session (clearing its fields and stamping revokedAt),
   resets `pushTokenRevokedAt` on re-upsert, and returns `401` when the caller session is revoked or
   expired (leaving the other session's token intact — the lock-first rule).
3. Revoke clears the caller's fields, is idempotent, and never touches another session.
4. Emitted operations match the pin; `npm run verify` + `verify:ci` green; parity manifest updated.

## Steps

- [x] Push platform port + specs
- [x] Session columns migration + repository upsert/revoke + session-revoke/takeover clears
- [x] Routes + manifest + emit + endpoint specs + verify + bookkeeping

## Decision Log

- 2026-10-11: one plan for both push endpoints. -> the pair shares the schema, repository, and port;
  splitting them would duplicate the same migration and wiring
- 2026-10-11: port-only push module (no FCM send path yet). -> ADR-0007; the endpoint's contract is
  satisfied by storage + the 501 gate, and credentials stay optional

## Verification

```bash
npm run db:generate                                        # migration 0003 (session push columns + unique token)
npx vitest run src/features/auth/push-token.spec.ts        # 9 endpoint tests: gate, storage, transfer, guards, validation
npx vitest run src/features/auth/push-token.repository.spec.ts  # lifecycle clears + session_not_found
# mutation probe: dropping the caller-liveness guard on the transfer statement turns the
#   "revoked session cannot clear another session" spec red; revert restores green
npm run contract:emit && npm run contract:check            # both ops emitted, parity ok
npm run verify                                             # fast profile green
```

## Completion Notes

Both push endpoints are mounted with the family's semantics: session-scoped token storage with global
uniqueness and lock-first ownership transfer (`EXISTS` guard on the clearing statement, so a
revoked/expired caller can never strip another session), `pushTokenRevokedAt` reset on re-upsert, an
idempotent liveness-free revoke, and the `501 AUTH_PUSH_NOT_CONFIGURED` gate checked before any work.
Session revocation and device takeover now clear push fields too. The push platform landed as a
port-only module (`PushPort.isEnabled`) because enabling FCM would require RS256 signing, which the
crypto allowlist (ADR-0006) forbids — the send path is deferred and the gate is exercised through an
injected enabled port in specs.

## Post-review fixes (2026-10-12)

- Dropped the redundant `sessions_active_key_idx` index: `active_key` is already uniquely indexed by
  the column constraint, so the second B-tree only doubled write amplification (ADR-0004 index
  discipline). Migrations 0003-0005 were regenerated from the corrected schema.
