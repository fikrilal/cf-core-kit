# Secrets scan gate

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0010 (deployment environments and rollback); roadmap Phase 6 follow-up

## Objective

A pattern-based secrets scan over `git ls-files` output joins the fast profile: private key
blocks, AWS-style access key ids, private Ed25519 JWKs, and secret-valued env assignments fail
the gate, with a documented allowlist for the public examples the docs and tests must contain.

## Design

- `scripts/security/secrets-scan.mjs`: `git ls-files -z` → read each tracked file (skip
  binaries by extension) → match patterns with line numbers → report `file:line: rule`.
  Exit 1 with the violation list; exit 0 clean.
- Patterns (`rule` ids): `private-key` (`-----BEGIN ... PRIVATE KEY-----`), `aws-access-key`
  (`AKIA[0-9A-Z]{16}`), `jwk-private` (`"kty":"OKP"... "d":"..."` within a short window),
  `secret-assignment` (`AUTH_SIGNING_KEYS_JSON|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID` followed by
  a base64-ish value of 16+ chars — the generator's `${...}` template does not match).
- Allowlist: exact strings with reasons (the AWS SigV4 documented example secret used by the
  presign spec is public knowledge; the scanner's own fixtures live in the test file, which is
  excluded from self-scanning by name? No — the fixture file legitimately contains examples;
  allowlist those exact strings with a reason, keep the fixtures realistic).
- Wiring: `secrets:check` package script + a fast-profile step (stable id `secrets:check`);
  `cfkit.test.ts`'s pinned step list and the duration policy gain the step.
- Tests (`scripts/security/secrets-scan.test.mjs`): each rule fires on a fixture; the allowlist
  suppresses the documented example; a clean tree passes (the real repo scan is part of the
  profile run).

## Acceptance Criteria

1. Each rule fires on a realistic fixture and reports file, line, and rule id.
2. The documented AWS example is allowlisted with its reason; the real repo scan passes.
3. The step runs in the fast profile with a stable id; `verify:ci` green.

## Steps

- [x] Scanner + fixtures + wiring (script, profile, test pins)

## Verification

```bash
node --test scripts/security/secrets-scan.test.mjs   # 6 tests: each rule fires on a runtime-built
                                                     # fixture, pretty-printed JWKs caught across
                                                     # lines, constant-reference assignments are
                                                     # clean, the allowlisted AWS example passes,
                                                     # the repository scans clean
npm run secrets:check                                # "no findings in tracked files"
npm run verify:ci                                    # secrets:check runs inside the fast profile
# findings handled: the AWS documented access-key + secret examples are allowlisted with
#   reasons; test/auth-fixtures.ts is allowlisted by path (suite-only signing keys); the
#   generator's ${...} template and `wrangler secret put` docs do not match
- [x] Verify + bookkeeping

## Decision Log

- 2026-10-11: pattern-based scanning of tracked files only. -> the roadmap asks for exactly this; gitignored `.dev.vars` stays out by construction
- 2026-10-11: allowlist by exact string with reasons. -> the AWS example is public and load-bearing for the presign vector test
```
