# auth.email.verify — verify an email with a token (endpoint 1 of 10)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0002 (contract parity), ADR-0004 (D1/Drizzle), ADR-0006 (OIDC-first auth); goal: all auth + users endpoints

## Objective

Mount `auth.email.verify` exactly as backend-core-kit behaves: a public `POST /v1/auth/email/verify`
taking `{ token }`, consuming a hashed email-verification token, setting `users.email_verified_at`
first-writer-wins, and answering `204` for both fresh verification and already-verified replays,
`400 AUTH_EMAIL_VERIFICATION_TOKEN_INVALID` for unknown/used/revoked tokens, and
`400 AUTH_EMAIL_VERIFICATION_TOKEN_EXPIRED` for expired ones.

## Behavior reference (backend-core-kit)

- Public route (no guard), no idempotency, no rate limit; `204` on success.
- Token model: `email_verification_tokens` rows with `sha256(raw)+base64url` as the unique hash, raw
  256-bit base64url token only in the email; TTL from `AUTH_EMAIL_VERIFICATION_TOKEN_TTL_SECONDS`
  (default 86400); `usedAt` written in every terminal outcome; `revokedAt` honored but never written.
- Consumption order (serializable tx upstream): lookup by hash → unknown → invalid; **user already
  verified** → mark used, answer `already_verified` (204); `revokedAt`/`usedAt` set → invalid;
  `expiresAt <= now` → expired; else guarded `updateMany` on `emailVerifiedAt IS NULL` + mark used →
  `ok`, or `already_verified` when the guard lost (0 rows).
- Verify minting nothing: no new tokens; clients re-login for a refreshed `email_verified` claim.

## Design (free-tier mapping)

- D1 has no interactive transactions: mirror the tx with a guarded `db.batch([...])` after a pre-read
  of the token row (single-writer D1 + batch atomicity + `meta.changes` branching). The pre-read
  decides the terminal states; the batch atomically guards the user update and marks the token used;
  a lost user guard yields `already_verified`.
- Table `email_verification_tokens`: id, user_id (FK cascade), token_hash (unique), expires_at,
  used_at, revoked_at, created_at, updated_at. Index discipline: unique hash + `user_id` index only
  (the backend's extra indexes serve queries we do not run; deviation recorded).
- Contract DTOs: `VerifyEmailRequestDto` must emit exactly the pin's shape — `required: [token]`,
  `{ type: string, example }` with **no** `minLength` (class-validator's `MinLength(1)` is not emitted
  upstream). Runtime non-empty validation therefore lives in a zod refinement (which does not emit) so
  parity and validation both hold.
- New typed error codes `AUTH_EMAIL_VERIFICATION_TOKEN_INVALID` / `AUTH_EMAIL_VERIFICATION_TOKEN_EXPIRED`
  (both present in the pin; the vocabulary tripwire enforces that).

## Constraints

- No token minting here (that arrives with the resend endpoint's email job); specs seed token rows
  directly like the upstream e2e suite does.
- No rate limit on this endpoint (upstream has none) — recorded as a parity decision, revisit with the
  family if the contract changes.
- Manifest moves `auth.email.verify` pending → implemented; emitter emits the operation byte-compatible.

## Acceptance Criteria

1. `204` for a valid token and `users.email_verified_at` set; a second use of the same token → `204`
   (already_verified); a valid token for an already-verified user → `204` and the token is marked used.
2. `400` with `AUTH_EMAIL_VERIFICATION_TOKEN_INVALID` for unknown, used, and revoked tokens;
   `400 AUTH_EMAIL_VERIFICATION_TOKEN_EXPIRED` for expired; `400 VALIDATION_FAILED` for missing/empty
   token.
3. `/v1/me` reflects `emailVerified: true` after verification with the same access token (projection
   reads the row).
4. Emitted operation matches the pin (contract:check + parity + spectral green); `npm run verify`
   fast and, at bookkeeping, the ci profile.

## Steps

- [x] Migration + schema + repository consumption primitive
- [x] Contract DTOs, route/operation metadata, manifest move, emit
- [x] Endpoint specs (state matrix + dialect) + verify + bookkeeping

## Decision Log

- 2026-10-11: guarded batch instead of a serializable tx. -> D1 has no interactive transactions; a
  pre-read plus a guarded batch reproduces the upstream outcomes with the single-writer engine
- 2026-10-11: refinement instead of `min(1)` on the DTO. -> upstream does not emit `minLength`; a
  refinement keeps runtime validation without breaking byte-parity

## Verification

```bash
npm run db:generate                 # migration 0002_swift_thor_girl.sql (email_verification_tokens)
npx vitest run src/features/auth/email-verification.spec.ts   # 8 tests, state matrix + dialect
npx vitest run test/integration/email-verification.spec.ts    # pre-verification token sees emailVerified on /v1/me
# mutation probe: dropping the revoked/used guard turns the two specs red (2 failed); revert restores green
npm run contract:emit               # emitted spec carries auth.email.verify (18199 bytes)
npm run verify                      # fast profile green: format, lint, typecheck, vitest (325), fixtures,
                                    # budget, secrets, drift, contract:check (parity ok), contract:lint
```

## Completion Notes

Mounted `auth.email.verify` with the family's exact state machine: pre-read by token hash, terminal
branches in upstream order (unknown -> invalid, already-verified -> mark used + 204, revoked/used ->
invalid, expired -> expired), then a guarded `db.batch` that atomically flips `email_verified_at`
(only when null) and stamps `used_at`; a lost guard degrades to `already_verified`. New table
`email_verification_tokens` (FK cascade, unique hash, `user_id` index) plus the two typed error codes.
One deviation recorded in the platform: `VerifyEmailRequestDto.token` carries a zod refinement rather
than `min(1)` because the upstream DTO does not emit `minLength` — runtime validation and byte-parity
both hold. The route module lives in `email-verification.routes.ts` (max-lines budget) and the
auth-only spec pairs with an integration spec for the cross-feature `/v1/me` reflection.
