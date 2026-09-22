# Guides and the scaffold smoke in CI (task 5.6)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0009 (cfkit CLI and the verify gate); roadmap task 5.6

## Objective

The harness becomes learnable and self-checking: `docs/guide/` lands (adding-a-feature,
adding-an-endpoint, config, jobs) mirroring the generators, and the scaffold smoke runs inside
the `ci` profile so a broken scaffold or unwiring fails CI.

## Behavior reference

backend-core-kit ships seven guides whose feature/endpoint guides mirror the generator output
exactly, and a `scaffold:smoke` script wired as a `full`-profile step: scaffold (two tiers,
with queue), wire, lint/typecheck, remove, assert absence, lint/typecheck, restore. Its smoke
verifies absence textually; our 5.2 makes byte-identical restoration the assertion.

## Design

- Guides: `docs/guide/README.md` (map), `adding-a-feature.md` (scaffold feature, slice shape,
  what it refuses), `adding-an-endpoint.md` (pending-operation flow: pick from
  `tools/parity/coverage.json` pending list, scaffold endpoint, replace TODO markers, run
  verify), `config.md` (every config key, secret vs var, per-environment rules), `jobs.md`
  (defineJob → registry → cron fan-out, sweep conventions, DLQ policy).
- `scripts/scaffold/smoke.mjs`: in a git worktree copy (or the live tree with `git diff
--exit-code` restoration): scaffold feature → scaffold endpoint (a synthetic pending
  operation injected into a fixture copy? No — use a real pending 204 op against the live tree,
  then `git checkout` the three edited files + delete generated paths in a `finally`), run
  `cfkit verify --profile ci`, remove, assert `git diff --exit-code` clean and paths gone,
  verify again. Self-cleaning on both success and failure.
- Wire as a `ci`-profile step (`scaffold.smoke`, stable id) and document the manual equivalent
  in the guides; CI runs it through `npm run verify:ci` without new workflow files.

## Acceptance Criteria

1. All four guides exist, mirror the generators byte-for-byte where they show output, and are
   covered by the docs link/drift checks.
2. The smoke passes on the live tree, fails when the scaffold is broken (probe by mutation),
   and always restores the tree (verified by `git diff --exit-code` in the smoke itself).
3. The smoke is a stable-id step in the `ci` profile; `verify:ci` green with it enabled.

## Steps

- [x] Guides (four files + index) cross-checked against generator output
- [x] Smoke script + profile wiring + restoration guarantees
- [x] Probe (broken scaffold fails the smoke) + bookkeeping

## Decision Log

- 2026-10-11: the smoke runs against the live tree with `git`-based restoration, not a copy. -> a full repo copy is heavy; `git checkout` of exactly the edited files plus deletion of generated paths is exact and cheap
- 2026-10-11: guides document refusals, not just the happy path. -> the tools refuse a lot by design; the guides must teach the boundaries

## Impact Areas

- Harness: `tools/cfkit/` (+ `scripts/` for the smoke); Docs/guides change with 5.6; no product
  or contract surface changes outside the manifest moves the endpoint scaffold performs.

## Verification

```bash
node scripts/scaffold/smoke.mjs     # the smoke itself, standalone: picks the first
                                    # scaffoldable pending operation (asking the scaffold, not a
                                    # heuristic), scaffolds feature + endpoint, runs format /
                                    # lint / typecheck / contract, removes both, asserts every
                                    # touched artifact matches its captured pre-scaffold bytes,
                                    # verifies again, and restores from the captured bytes in a
                                    # finally even on failure
npm run verify:ci                   # ci profile: full (11 steps) + runtime.smoke (2s) +
                                    # scaffold.smoke (39s) — all green; ci observed duration
                                    # recalibrated to 110s against the 360s advisory
```

## Completion Notes

The guides land with the smoke wired as a stable-id `ci` step, and the cycle they describe is
asserted on every CI run: scaffold a feature and a real pending operation, run the static gates
on the scaffolded tree, remove both, and prove byte-identical restoration before verifying the
restored tree again. Two design points earned by building it: the smoke asks
`buildEndpointScaffold` which pending operation is scaffoldable instead of reimplementing the
shape/code/tag rules (one source of validation), and restoration is a captured-bytes compare
and rewrite rather than `git checkout` — the first version's checkout silently revert
unrelated pending edits (it wiped a real in-progress change twice before being replaced).

The smoke's own failure path found the last lint-gap too: eslint's `.mjs` globals lacked
`URL`, so the script failed its own lint gate until the global joined the list (the same class
as the earlier `Buffer` case). The manifest sorting normalization from 5.2 was then restored
(it had been reverted by the same checkout) and is part of this change.
