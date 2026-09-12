# OIDC sign-in end to end (task 3.2)

- Status: completed
- Owner: fikrilal
- Risk: high
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0006 (OIDC-first, Ed25519 access tokens, RS256 verify allowed), ADR-0003 (zod-openapi pipeline), ADR-0002 (contract parity), ADR-0007; roadmap task 3.2

## Objective

`auth.oidc.exchange` and `auth.oidc.connect` are mounted, contract-green, and tested end to end: provider ID-token verification against cached Google JWKS (RS256 verify only), user upsert + identity linking with the family's exact semantics, first-party Ed25519 access tokens and opaque hashed refresh tokens, and `MeDto` assembly. This task also lands the platform modules the rest of the phase builds on: `src/platform/crypto` (WebCrypto primitives), `src/platform/auth` (signing keyring, access-token issuer/verifier, `requireAuth` guard + principal), and the two features `src/features/auth` + `src/features/users` (the projection consumers of `MeDto`).

## Behavior reference (mirror exactly; backend-core-kit recon)

- Exchange: verify id_token (Google issuer allow-list, audience = configured client IDs, RS256 against `https://www.googleapis.com/oauth2/v3/certs`, required `sub`/`email`/`email_verified`) → `not configured` 500 `AUTH_OIDC_NOT_CONFIGURED`; verify failure 401 `AUTH_OIDC_TOKEN_INVALID`; unverified email 400 `AUTH_OIDC_EMAIL_NOT_VERIFIED`; lookup `(provider, subject)`; missing identity + existing email → 409 `AUTH_OIDC_LINK_REQUIRED` (never auto-link); DELETED user → 401 `AUTH_INVALID_CREDENTIALS`; SUSPENDED → 403 `AUTH_USER_SUSPENDED`; else create user (emailVerified now, profile names from claims) + identity, create session, return `{ data: { user: MeDto, accessToken, refreshToken } }` (200).
- Connect (bearer, idempotent, `scopeKey: "auth.oidc.connect"`): already linked to this user → 204; identity owned by another user → 409 `AUTH_OIDC_IDENTITY_ALREADY_LINKED`; user has a different Google identity → 409 `AUTH_OIDC_PROVIDER_ALREADY_LINKED`; matching verified email back-fills `emailVerifiedAt`; success → 204.
- Access token: header `{alg: EdDSA, kid, typ: JWT}`; claims `{sub, sid, email_verified, roles, typ: "access", iat, exp, jti}` — no email/PII; TTL default 900s.
- Refresh token: 32 random bytes base64url, stored only as SHA-256 base64url; TTL default 2592000s; session `expiresAt` fixed at creation; `activeKey = userId:deviceId` when a deviceId is provided (existing active session for that device is revoked first).
- Error-code statuses (title = status title unless `VALIDATION_FAILED`): LINK_REQUIRED/IDENTITY_ALREADY_LINKED/PROVIDER_ALREADY_LINKED → 409; EMAIL_NOT_VERIFIED → 400; NOT_CONFIGURED → 500; TOKEN_INVALID → 401; SUSPENDED → 403; INVALID_CREDENTIALS → 401.

## Constraints

- Hand-rolled WebCrypto in `src/platform/crypto` (no `jose` dependency): Ed25519 sign/verify, RS256 verify, SHA-256 base64url, random tokens. The budget check's crypto allowlist stays intact (`crypto.subtle` only under `src/platform/`); RS256 **signing** remains banned in src (tests may sign to emulate Google).
- Keyring from `AUTH_SIGNING_KEYS_JSON` (+ base64 variant), mirroring backend's format: JSON array or `{keys:[]}`, `kid` required, first usable private key signs, all public keys publishable; **no ephemeral dev keys** (Workers isolates rotate — a per-isolate key breaks sign/verify across isolates); `scripts/auth/generate-keys.mjs` prints a dev keypair for `.dev.vars`; tests pass fixed test keys.
- Config additions (zod, typed errors): `AUTH_SIGNING_KEYS_JSON`, `AUTH_SIGNING_KEYS_JSON_BASE64`, `AUTH_OIDC_GOOGLE_CLIENT_IDS` (comma-separated), `AUTH_ISSUER`/`AUTH_AUDIENCE` (optional; included in claims when set), `AUTH_ACCESS_TOKEN_TTL_SECONDS` (900), `AUTH_REFRESH_TOKEN_TTL_SECONDS` (2592000). `AUTH_JWT_ALG` is not ported (EdDSA fixed — RS256 signing is banned).
- Graceful degradation mirrors backend: unset OIDC client IDs is not a boot failure — the endpoint answers 500 `AUTH_OIDC_NOT_CONFIGURED`; unset signing keys fail the request path that needs them with INTERNAL and a logged error (never a silent dev key).
- Routes: zod `createRoute` definitions with `.meta({ id })` mirroring the snapshot's DTO names (`OidcExchangeRequestDto`, `OidcConnectRequestDto`, `AuthResultWithMeEnvelopeDto`, `AuthResultDto`, `AuthUserDto`, `MeDto`, `MeProfileDto`, `LogoutRequestDto`, `RefreshRequestDto` in shared contract modules under `src/shared/contract/`); operation metadata carries x-error-codes from the typed AUTH_* constants.
- Error codes: add the 11 AUTH_* values used by the mounted ops to `src/shared/error-codes.ts` (exact backend names) + a tripwire spec asserting every value appears in the pinned snapshot's x-error-codes vocabulary.
- Parity comparator refinement: normalize cosmetic keys (`description`, `example`) and nullable representations before deep comparison, and update fixtures — client-visible type structure stays strictly compared.
- Emitter: global `Auth` tag entry + `components.securitySchemes.access-token` (bearer, JWT) + per-op `security` from route definitions.
- Idempotency on connect via the existing middleware (`scopeKey: "auth.oidc.connect"`, optional header); replay semantics already platform-tested.
- Manifest: move `auth.oidc.exchange` and `auth.oidc.connect` from `pending` to `implemented` in the same change (the parity gate enforces both directions).

## Impact Areas

- API / contract: two operations mounted; emitted spec + parity manifest move together; Auth/security: the whole sign-in path; Budget: Ed25519/sha256 are sub-ms, one D1 batch per sign-in; Secrets: signing keys never logged (redaction list already covers `AUTH_SIGNING_KEYS_JSON`).

## Acceptance Criteria

1. Exchange + connect mounted; emitted spec regenerates cleanly with the exact snapshot shapes (parity check green for both ops, `$ref`-resolved).
2. Behavior matrix tested in the Workers pool with a stubbed JWKS loader: new user, existing identity, link-required, unverified email, suspended, not-configured, invalid token, connect success/already-linked/both conflicts; guard 401 without bearer.
3. Access-token round-trip unit tests (claims, kid/typ, exp) and refresh-token hashing tests.
4. AUTH_* constants + tripwire spec; `npm run verify` + `verify:ci` green; roadmap 3.2 checked.

## Steps

- [x] Platform crypto + platform auth (keyring, issuer/verifier, guard) + config additions + generate-keys script
- [x] Contract DTOs in `src/shared/contract/`; features/auth services + repositories; features/users Me projection
- [x] Routes (exchange + connect), error codes, emitter additions; emit + manifest updates
- [x] Tests (behavior matrix, token round-trip, tripwire); probes where a gate grew; verify + bookkeeping

## Decision Log

- 2026-10-11: no `jose` dependency; WebCrypto primitives under `src/platform/crypto`. -> keeps the crypto allowlist meaningful, the bundle lean, and the CPU path explicit
- 2026-10-11: no ephemeral dev signing keys. -> Workers isolates make per-isolate keys incorrect; a generator script + `.dev.vars` keeps dev deterministic
- 2026-10-11: `src/features/users` lands with only the Me projection; its routes come in 3.6. -> exchange must return MeDto per contract, and the projection belongs to the users feature (cross-feature import through its exported surface)
- 2026-10-11: parity comparator normalizes `description`/`example`/nullable style. -> copy and examples are behavior-layer; type structure stays contractual

## Verification

```bash
npm run verify:ci     # full profile green (11 steps): format, lint, typecheck, typecheck:cfkit,
                      # vitest (211 tests across 34 files), script fixtures (51), budget
                      # (1150.57 KiB), drift, contract:check (parity ok), contract:lint, build
npm run contract:emit # docs/openapi/openapi.yaml carries both auth operations (7174 bytes)
# behavior matrix: exchange (new user, repeat sign-in with device revocation, link-required,
#   suspended/deleted, unverified, real-RS256-through-route, not-configured, malformed,
#   provider enum) and connect (401 no/garbage token, link + email backfill, no backfill on
#   mismatch, already-linked idempotence, identity/provider conflicts, idempotent replay)
# platform specs: crypto vectors + Ed25519/RS256 round-trips; keyring parsing/memoization;
#   access-token issuance + rejection matrix; JWKS cache with cooldown-limited refetch
# contract comparator refinements: cosmetic keys, single-branch allOf flattening, parameter
#   normalization, ref-depth 64 - each fixture-proven
# budget gate found context.env in the feature (ADR-0008) -> platform request accessors
```

## Completion Notes

The sign-in flow is mounted, contract-green, and tested end to end. Platform gained `crypto` (WebCrypto primitives — no jose dependency), `auth` (keyring from `AUTH_SIGNING_KEYS_JSON` with a public-only whitelist, Ed25519 issuer/verifier with the family claim set, `requireAuth` guard), config additions (TTLs 900/2592000, client ids, issuer/audience), and request accessors (`databaseFrom`/`configFrom`) because the budget gate correctly flagged feature code touching `context.env`. Features: `features/users` (Me projection + wire payload) and `features/auth` (OIDC verification with cooldown-limited JWKS refetch, session issuance with hashed refresh tokens and device-scoped revocation, exchange + connect routes, typed AUTH_* error codes). Notable findings fixed en route: zod-openapi's default validation response bypassed the RFC7807 pipeline (now a `defaultHook` throws `AppError`; handlers use the pre-validated body); workerd refuses private JWKs for verify usage (whitelist import); workerd JWK objects carry absent fields as own `undefined` properties (`"d" in jwk` is true — value checks instead).

## Review Round 1 Fixes (2026-10-11)

An external review round returned CHANGES_REQUIRED; every finding is fixed on this tree:

1. **Undeclared error code / false attribution** — deleted accounts now return the declared 401 `AUTH_OIDC_TOKEN_INVALID` (opaque rejection; the upstream spec does not declare the `AUTH_INVALID_CREDENTIALS` its own implementation emits — recorded divergence, client status unchanged); the four internal lookup-failure sites now throw 500 `INTERNAL` instead of a client 401; `AUTH_INVALID_CREDENTIALS` is removed from the typed union (no dead surface).
2. **Plan honesty: tooling and tripwire** — `scripts/auth/generate-keys.mjs` (+ `node:test` fixture proving the JWK signs and the `.dev.vars` values round-trip) and a README "Local auth keys" section now exist; the error-code vocabulary tripwire lives in `contract:check` (`checkErrorCodeVocabulary`: every `ErrorCode` value must appear in the pinned snapshot's `x-error-codes`, two fixtures) because pool specs cannot read files — `error-codes.spec.ts` keeps the pinned-values check and names the enforcement point.
3. **Cross-feature import** — `oidc.service.ts` imports through `../users/index` only; the dead `MeView` re-export is gone.
4. **connect race** — the insert-conflict path now also inspects `(user_id, provider)` and returns 409 `AUTH_OIDC_PROVIDER_ALREADY_LINKED` instead of leaking a constraint 500.
5. **connect failure-path coverage** — tests added: unverified email (400), invalid token (401), not configured (500), invalid payload (400 `VALIDATION_FAILED`).
6. **Redaction** — `auth_signing_keys_json_base64` added to the deny list, with a spec case.
7. **Deterministic fixtures** — `googleClaims` uses a fixed `TEST_TOKEN_INSTANT`; real verifiers in specs run on `fixedClock(TEST_TOKEN_INSTANT)`; no `Date.now()` remains in fixtures.
8. **Email normalization** — storage and lookup lowercase emails (trim + lowercase); an exchange test proves mixed-case claims match an existing account (409 link required).
9. **noContent helper** — the connect handler returns the platform `noContent()`.
10. **Bearer scheme** — `extractBearerToken` accepts any scheme casing; a connect test covers lowercase `bearer`.

Verification after the fixes: `npm run verify:ci` green (11 steps), 217 vitest tests across 34 files, 55 script fixtures, budget 1151.46 KiB.
