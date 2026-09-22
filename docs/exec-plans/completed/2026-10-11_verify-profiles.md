# Verify profiles: runtime + ci, step ids, duration advisories (task 5.3)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0009 (cfkit CLI and the verify gate); roadmap task 5.3

## Objective

Verify profiles reach their final shape: `fast` (developer loop), `full` (current CI static
set), `ci` (nested full + runtime), and `runtime` (a real local boot smoke). Every step carries
a stable id, and each profile carries advisory duration budgets that warn without failing.

## Behavior reference

backend-core-kit's registry: steps `{kind: npm | profile, id, title, script}` with cycle
detection, `ci` nested from `full` + `runtime`, ids keyed by its failure taxonomy, and
`duration-policy.ts` printing `Duration advisory: <profile> took <ms>ms; calibration budget is
<advisory>ms` on overrun (observed baselines recorded alongside). Its runtime lane is a single
Docker-backed harness step.

## Design

- `VERIFY_PROFILES` gains `runtime` and `ci`; `ci` nests `full` + `runtime` (cycle-checked).
- `runtime` step: `tools/cfkit/runtime.ts` boots `wrangler dev` on an ephemeral port with
  generated signing keys and a scratch `--persist-to` directory, waits for `/health`, asserts
  `/health`, `/ready`, and the JWKS endpoint respond correctly (statuses + no private material),
  then terminates the server — the 3.8 harness, committed and deterministic.
- Stable step ids: `VerifyStep` gains `id` (e.g. `budget`, `contract`, `runtime.smoke`); the
  runner reports `{id, durationMs}` per step; ids are pinned by tests.
- Advisory budgets: `tools/cfkit/duration-policy.ts` with per-profile `{observedMs, advisoryMs}`
  seeded from real runs; overruns print an advisory line, never fail. A meta-test pins that
  budgets are advisory-only (a slow step still passes).

## Acceptance Criteria

1. `cfkit verify --profile runtime` boots and asserts the app locally, cleans up the process,
   and fails when an assertion fails (probe).
2. `ci` = `full` + `runtime`, cycle detection intact, ids stable and test-pinned.
3. Advisory overruns warn without failing; the policy file records observed baselines.
4. `npm run verify` (fast) and `verify:ci` behavior documented; `verify:ci` green.

## Steps

- [x] Registry + ids + nested ci + duration policy
- [x] runtime step (boot smoke) + cleanup
- [x] Tests (probe failures, advisory semantics) + docs + bookkeeping

## Decision Log

- 2026-10-11: runtime as a committed local boot smoke. -> the credentialed dashboard-CPU lane cannot run in CI; boot + dialect checks are the strongest deterministic substitute and reuse the 3.8 harness
- 2026-10-11: advisory budgets only. -> durations vary by machine; gates must not flake on wall-clock

## Impact Areas

- Harness: `tools/cfkit/` (+ `scripts/` for the smoke); Docs/guides change with 5.6; no product
  or contract surface changes outside the manifest moves the endpoint scaffold performs.

## Verification

```bash
node --test tools/cfkit/cfkit.test.ts   # profile shape + expansion order (ci = full then
                                       # runtime.smoke), every step script exists in
                                       # package.json, composition cycle rejected, duration
                                       # budgets advisory-only under and over budget, runner
                                       # order/failure/id/duration semantics

npm run verify:ci                      # ci profile (full + runtime) passed end to end:
                                       # full's eleven steps, then the runtime boot smoke
                                       # (wrangler dev on a scratch persist dir, generated
                                       # signing keys, /health + /ready + JWKS asserted,
                                       # server group killed, temp dir removed) in 2.0s;
                                       # profile total ~71s — the observed baselines in
                                       # duration-policy.ts were calibrated from this run
                                       # (fast 68s, full 70s, runtime 3s, ci 75s)
```

## Completion Notes

The verify surface now has four profiles with stable step ids and advisory-only duration
budgets. `fast` and `full` keep their steps, `runtime` is the committed 3.8 harness (wrangler
dev on a scratch `--persist-to` directory with generated signing keys; `/health`, `/ready`, and
the JWKS endpoint asserted; the server killed by process group and the temp directory removed in
a `finally`), and `ci` composes `full` + `runtime` through the registry with cycle detection
instead of copying step lists. `npm run verify:ci` now runs the `ci` profile, so the local boot
smoke gates every run at ~2 seconds of marginal cost.

Two deliberate properties: overruns print the backend-style advisory line and never change the
exit code (wall-clock varies by machine; gates must not flake), and the observed baselines are
recorded next to the advisory ceilings so calibration is explicit rather than implied.
