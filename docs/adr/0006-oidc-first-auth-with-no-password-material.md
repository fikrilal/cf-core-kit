# ADR: OIDC-First Auth with No Password Material

- Status: Accepted
- Date: 2026-10-10
- Decision makers: Core kit maintainers

## Context

Safe password hashing (Argon2id, bcrypt, or OWASP-grade PBKDF2) needs 50–300ms of CPU per attempt. The free tier allows 10ms per invocation, and the Workers runtime hard-caps WebCrypto PBKDF2 at 100,000 iterations (`NotSupportedError`; below the OWASP recommendation of 600k). Password verification on the free plan is therefore either impossible or weak.

The wire contract still requires the family session model: access JWT with JWKS, opaque refresh tokens with rotation, and stable auth error codes.

## Decision

v1 ships **OIDC-first auth and stores no password material anywhere**:

- **OIDC sign-in**: authorize redirect + callback with `state`/PKCE; code exchange (one `fetch`); ID-token verification against cached JWKS (RS256 verification allowed — public-key verify only; RSA signing banned); user upsert + provider link.
- **Sessions**: opaque refresh tokens in D1 with rotation + reuse detection; TTL sweep via the fan-out cron.
- **Access tokens**: Ed25519 (EdDSA) with a JWKS endpoint; verification is native WebCrypto (sub-ms).
- **Descoped**: `auth.password.*` operations are removed from scope and recorded in the parity manifest (ADR-0002). No hasher, no adapters, no dead abstraction in v1 code.
- **Backlog order** (decided): 1) magic link (pulls the email module back in as an auth-critical dependency), 2) password revival (gated on the deferred M0 spike: DO CPU budget on free + WASM Argon2id at OWASP-grade parameters), 3) passkeys.
- **Auth-path rate limiting**: DO memory-first counters; generic rate limiting deferred.

## Rationale

OIDC has no KDF surface, is CPU-trivial (one signature verification plus session writes), keeps email off the auth critical path, and is already part of the family contract. The identity funnel (method → principal → session issuance) stays architectural, so backlog methods plug in without touching the token model.

## Consequences

Positive: free-tier-safe auth with strong parameters by construction; nothing hashable to breach; the descope is explicit and reversible.

Negative: users need an IdP account; password operations are a documented client-visible gap (family parity is scoped, not total); password revival later requires the M0 spike and adapter work.

## Alternatives Considered

- DO + WASM Argon2id in v1 — deferred: depends on an unresolved platform question (free-plan DO CPU budget); not on the critical path.
- Inline PBKDF2 at ≤ 100k iterations — rejected: below OWASP guidance and still near the CPU wall.
- External auth provider (Clerk/Auth0) — rejected as kit machinery: password-capable OIDC providers can be used through the existing OIDC method instead.
- Stub password routes — rejected (ADR-0002).

## Links / References

- Related ADRs: ADR-0002, ADR-0007
- Related docs: `docs/core/project-architecture.md`
- Related proposals: `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`
