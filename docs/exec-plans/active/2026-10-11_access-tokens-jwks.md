# Access tokens: keyring and JWKS endpoint (task 3.4)

- Status: active
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0006, ADR-0007; roadmap task 3.4

## Objective

`auth.jwks.get` publishes the public key set at `/.well-known/jwks.json`, and the keyring becomes rotation-ready: multiple keys in `AUTH_SIGNING_KEYS_JSON` (current signing key first, previous public keys retained), `kid` selection on sign, `kid`-scoped verification, and normative config documentation. Verification hardening lands with it: header requires `kid`+`alg` matching the key, `typ: "access"`, clock skew 60s, `jti`/`sub`/`sid` non-empty and bounded, max token length 16384.

## Constraints

- Public material only in responses: JWK per key = exported public JWK + `kid`, `use: "sig"`, `alg` (private `d` never rendered; a test asserts its absence).
- The endpoint is envelope-skipped (raw `{ keys: [...] }`), matching the snapshot's loose schema (`array of objects`) and backend's registration outside `/v1`.
- Key rotation stays configuration-driven (add key at the front, deploy, retire later); README gains the key-operations section (generate, deploy as `wrangler secret`, rotate, verify JWKS).
- Verification never trusts `alg` from the token beyond matching the key's configured algorithm; unknown `kid` → 401 UNAUTHORIZED.
- Manifest moves `auth.jwks.get` to `implemented`; emitted spec regenerates (loose object schema mirrors exactly).

## Impact Areas

- API / contract: one operation mounted; Auth: verification surface; Ops: rotation runbook.

## Acceptance Criteria

1. JWKS returns all configured public keys with `kid`/`use`/`alg` and no private fields (test asserts absence).
2. Multi-key ring tests: sign with the current key; a token from the previous key still verifies; unknown kid, wrong alg, `typ` mismatch, expired, future-iat, oversized, and empty-claim tokens are all 401.
3. Guard coverage via a protected fixture route (and connect) in the pool; parity/spectral green; `npm run verify` green; roadmap 3.4 checked.

## Steps

- [ ] Keyring multi-key support + kid selection/verification hardening
- [ ] `auth.jwks.get` route + envelope-skip wiring + manifest/spec
- [ ] Tests (public-only assertion, multi-key, rejection matrix) + README key ops; verify + bookkeeping

## Decision Log

- 2026-10-11: JWKS lives at `/.well-known/jwks.json` outside `/v1`, raw body. -> mirrors the family contract and client expectations
- 2026-10-11: verification binds `alg` to the configured key instead of trusting the header. -> key-confusion resistance without RSA signing in scope

## Verification

```bash
npm run verify   # (to be recorded)
```
