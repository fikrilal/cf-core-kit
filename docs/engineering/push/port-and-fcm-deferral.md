# Push: a port now, FCM later

**What it does.** `PUT /v1/me/push-token` registers a device token and `DELETE` retires it. Delivery itself is
**not implemented**: `PushPort.isEnabled()` returns false, so the route answers `501 AUTH_PUSH_NOT_CONFIGURED`
and touches nothing — a disabled integration that says so, instead of a silent no-op.

**Where it lives.** `src/platform/push/push.ts` (port + stub), `src/features/auth/push-tokens/` (routes,
repository, ownership checks).

**Why FCM is deferred.** The FCM HTTP v1 API requires RSA-signed (RS256) assertions, and this repository's crypto
allowlist permits Ed25519/ES256 signing plus RS256 **verification only** (ADR-0006). Rather than carve an
exception for one integration, the port exists, the token lifecycle is complete and tested, and delivery waits
for a policy decision.

**Evidence.** `src/features/auth/push-tokens/push-token.spec.ts` (registration, ownership, the disabled path) and
the contract suite for the 501 dialect.
