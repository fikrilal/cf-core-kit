# Access tokens: keyring and JWKS endpoint (task 3.4)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0006, ADR-0007; roadmap task 3.4

## Objective

`auth.jwks.get` publishes the public key set at `/.well-known/jwks.json`, and the keyring becomes rotation-ready: multiple keys in `AUTH_SIGNING_KEYS_JSON` (current signing key first, previous public keys retained), `kid` selection on sign, `kid`-scoped verification, and normative config documentation. Verification hardening lands with it: header requires `kid`+`alg` matching the key, `typ: "access"`, clock skew 60s, `jti` non-empty and bounded (128), `sub`/`sid` non-empty (the whole token is capped at 16384 bytes).

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

- [x] Keyring multi-key support + kid selection/verification hardening
- [x] `auth.jwks.get` route + envelope-skip wiring + manifest/spec
- [x] Tests (public-only assertion, multi-key, rejection matrix) + README key ops; verify + bookkeeping

## Decision Log

- 2026-10-11: JWKS lives at `/.well-known/jwks.json` outside `/v1`, raw body. -> mirrors the family contract and client expectations
- 2026-10-11: verification binds `alg` to the configured key instead of trusting the header. -> key-confusion resistance without RSA signing in scope

## Verification

```bash
npm run verify:ci   # full profile green (11 steps): 234 vitest tests across 37 files, 56 script
                    # fixtures, budget green, drift green, parity ok (five auth ops emitted),
                    # spectral ok, build ok
npm run contract:emit   # docs/openapi/openapi.yaml now carries auth.jwks.get (10,689 bytes)
# tests: JWKS publishes public-only material (no "d"), rotation sets publish retired keys in
#   order, missing keys report INTERNAL; access-token rotation (pre-rotation tokens still
#   verify, new tokens signed by the current key and rejected by the previous-only ring);
#   keyring signs with the first private key of a mixed set
```

## Live Evidence (wrangler dev)

`GET /.well-known/jwks.json` served 200 through real workerd with a generated dev key set,
returning the public-only JWK (no `d`) and echoing `X-Request-Id` (see the 3.5 plan for the
full smoke transcript).

## Completion Notes

`auth.jwks.get` is published at `/.well-known/jwks.json` (raw body, envelope-skipped; mirrors the
snapshot's loose schema exactly after the comparator learned to normalize empty containers —
`z.object({})` emits `properties: {}` where the snapshot omits it). The keyring was already
multi-key from 3.2; this task proved and documented it: the first private Ed25519 key signs,
every configured key (including retired public-only ones) stays published with `kid`/`use`/`alg`,
and verification binds `alg` to the configured key per `kid`. Rotation is configuration-driven —
prepend the new key, deploy, keep previous keys until outstanding access tokens expire (15 min),
retire — documented in the README. A missing key set fails the endpoint with the platform's
generic 500 `INTERNAL` (never a silent dev key).

## Review Round 2 Fixes (adversarial self-review)

An independent review of this task's uncommitted work returned findings, all fixed:

1. **High — mixed Ed25519/RSA rings turned guarded routes into 500s**: an attacker-supplied `alg: "RS256"` header could select a published RSA key, reach `verifyEd25519`, and throw (`DOMException`) instead of returning a clean 401. `findVerificationKey` now rejects any `alg` other than `EdDSA` (the kit never signs RSA access tokens), with a mixed-ring regression test.
2. **Medium — empty `AUTH_SIGNING_KEYS_JSON` masked the base64 fallback**: `""` is not `null`, so a blank JSON variable (or `.dev.vars` placeholder) caused a total auth/JWKS outage even with a valid `AUTH_SIGNING_KEYS_JSON_BASE64` present; the ring cache was also keyed on the raw fields. Source resolution is now an effective-source helper (blank JSON falls back to base64) and the cache is keyed on that effective source.
3. **Low — duplicate kid before private material**: `[public(kid k), private(kid k)]` failed the whole ring; duplicates now prefer the entry with private material.
4. **Low — README retire timing ignored the 60 s verification skew**: the runbook now says TTL + skew (16 minutes) and names `AUTH_ACCESS_TOKEN_TTL_SECONDS`.
5. **Low — untested hardening branches**: future `nbf`, oversized `jti`, empty `sid`, and missing `roles` (intentionally `[]`) now have tests; the plan wording above was corrected.

Counts after the fixes: 252 vitest tests across 39 files, 60 script fixtures.
