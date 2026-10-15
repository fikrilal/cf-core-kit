# Auth: Google sign-in (OIDC)

**What it does.** `POST /v1/auth/oidc/connect` verifies a Google ID token, links or creates the user, opens a
session and returns the token pair. `POST /v1/auth/oidc/exchange` trades a one-time code for the same pair.

**Where it lives.** `src/features/auth/oidc/` (routes, service, the verifier seam), `platform/auth/` for the key
ring and access tokens.

**Seams.** The verifier is injected (`IdTokenVerifier`), so specs use `fakeVerifier()` and the integration suites
exercise the real wiring. The signing key ring comes from config; tests pass `authEnv()`.

**Evidence.** `src/features/auth/oidc/connect.spec.ts` (per-branch behaviour), the contract suite for the dialect,
and `oracles.auth.email-verification-delivery` for the delivery path it can trigger.

**Deferred.** No Google-hosted end-to-end run: that needs real credentials (ADR-0010's credentialed lane).
