# Sensors: config drift, dependency audit, LF pinning (harness parity A3)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.2 (rows 2.1, 2.10, 2.12), §5.1 (row 1.3), §7 batch A; ADR-0005 (budgets), ADR-0010 (environments)

## Objective

Third plan of batch A: the small static sensors the programme leans on — a config-drift gate reconciling
`wrangler.jsonc` and the documented secrets with the zod config schema, the production dependency audit as a
profile step, LF pinning for byte-compared migration snapshots, and the first honest re-calibration of the
per-profile duration budgets from clean runs.

## Behaviour reference (backend-core-kit)

- `verify-env-example.ts`: `env.example` keys must exist in the config schema, required keys must be present,
  and a production-like validation runs with the invariant overrides. Our "env example" is `wrangler.jsonc`
  vars plus the README deploy runbook that documents secrets.
- `audit:prod` (`npm audit --omit=dev --audit-level=high`) runs in the `full` profile.
- `.gitattributes` pins LF for checksum-sensitive paths (their Prisma migrations; our Drizzle snapshots).
- Duration budgets are advisory, calibrated from clean runs, and never fail (family policy).

## Design

- `scripts/config/check.mjs` (`config:check`, a fast-profile step) parses `wrangler.jsonc` with the budget
  checker's JSONC reader and enforces four rules: every var in every scope (root + `env.dev/staging/prod`) is a
  config key; `APP_ENV` is present everywhere; all scopes declare the same var key set as the root; and every
  key in the `ConfigKey` union matches the zod schema in both directions. Documented secrets
  (`wrangler secret put <NAME>` in the README, minus the `NAME` placeholder) must also be config keys.
- `audit:prod` delegates to `npm audit --omit=dev --audit-level=high` and joins the `full` profile.
- `.gitattributes` pins `db/migrations/**` to LF because `drift:check` byte-compares the generated snapshots.
- Duration budgets re-calibrated 2026-10-12 from clean runs (fast 98.2s, ci 207.1s, runtime.smoke 2.5s,
  scaffold.smoke 53.1s; full derived as ci minus the composed profiles = 151.5s), with advisories ~2x the
  observed baselines and a 30s floor for the second-scale runtime smoke.

## Constraints

- Additive static checks: no runtime, contract or budget change.
- Both new steps carry taxonomy entries (`verify.environment`, `verify.security`) so the profile-coverage
  fixture stays green.
- `audit:prod` needs network access; an unreachable registry fails the step (family behaviour) and is
  recorded as an accepted trade-off rather than papered over.

## Acceptance Criteria

1. `config:check` passes on the repository's own surfaces and fails, with precise markers, for an unknown var,
   a scope that diverges from the root, a missing required var, either direction of schema/`ConfigKey` drift,
   and a documented secret that is not a config key (fixtures).
2. `audit:prod` exists, runs, and is wired into the `full` profile.
3. `.gitattributes` pins LF for `db/migrations/**`, and the manifest records it as present.
4. Duration budgets reflect measured clean runs with the calibration date recorded in the policy file.
5. `npm run verify` and `npm run verify:ci` stay green; the parity manifest flips three rows to `present`.

## Steps

- [x] `scripts/config/check.mjs` + seven fixtures + `config:check` script and fast-profile step
- [x] `audit:prod` script, full-profile step, taxonomy entry
- [x] `.gitattributes` LF pinning; manifest rows flipped (18 present)
- [x] duration budgets re-calibrated from clean runs; `cfkit.test.ts` profile lists updated
- [x] probe the config gate, verify, bookkeeping

## Decision Log

- 2026-10-12: the config gate reads the README as the secret inventory. -> we deliberately have no
  `env.example`; the deploy runbook is where secrets are documented, so that is what the gate checks.
- 2026-10-12: scope var key sets must match the root scope. -> a var added to one environment and forgotten in
  another is the failure mode this catches (dev/staging/prod are re-declared on purpose, ADR-0010).
- 2026-10-12: `audit:prod` joins `full`, not `fast`. -> network-dependent checks must not gate the
  developer's inner loop.

## Verification

```bash
npm run config:check                    # green on the real surfaces
npm run audit:prod                      # found 0 vulnerabilities
node --test scripts/config/check.test.mjs   # 7 fixtures: unknown var, scope divergence, missing required,
                                            # ConfigKey drift (both directions), ghost secret, placeholder ignored
# probe: planting a GHOST_VAR in wrangler.jsonc turns config:check red with
#   `x root: "GHOST_VAR" is not a config key` plus per-scope divergence markers; revert restores green
# timed clean runs (calibration): fast 98.2s, ci 207.1s; runtime.smoke 2.5s, scaffold.smoke 53.1s
npm run verify                          # fast profile green (config:check is now a step)
npm run verify:ci                       # ci profile green (audit:prod runs in the full profile)
```

## Completion Notes

Three sensors landed and three rows of the parity manifest flipped (18 of 46 present). Two honest notes: the
`ConfigKey` union and the zod schema already agreed — an earlier suspicion about five missing R2/base64 keys
was a grep-regex artifact (digit-bearing names), and the new fixture now pins that agreement permanently.
Second, `audit:prod`'s failure mode is npm's own exit code; it is proven by delegation and wiring rather than
by a fixture that would require planting a vulnerable dependency, and that limitation is recorded here rather
than hidden behind a probe that cannot fail.
