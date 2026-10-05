# Gate honesty (harness parity A6)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.5, §7 batch A; ADR-0011 (gate honesty)

## Objective

Close batch A by proving the gates bite. Every custom gate gets a probe that plants a known violation,
runs the **wired** npm script, asserts the gate's own failure marker, and restores the tree byte-identically.

## Behaviour reference (backend-core-kit)

- `ci-plant-mutation.mjs` / `script-fixtures.mjs` / `env-validation-smoke.mjs`: planted violations driven through
  the real scripts, marker assertions on the output, a self-check that the harness itself can fail, byte-level
  cleanup, and CI wiring so the honesty check runs on every pipeline.

## Design

- `scripts/gates/check.mjs` (`npm run verify:gates`, the `gates` profile, composed only by `ci` —
  `full` stays probe-free so a developer's normal verify never plants anything):
  - probes: `budget:check` (a feature touching `env.JOBS`), `secrets:check` (a PEM header in a tracked source),
    `drift:check` (a markdown link to a missing file), `contract:check` (a committed contract that no longer
    matches what the routes emit), `config:check` (a wrangler var that is not a config key), `harness:parity`
    (a `present` row citing missing evidence), `smells:check` (a job module the registry never imports),
    `duplication:check` (a twelve-line helper copied into two tracked files).
  - plant modes: `append`, `replace`, `create` and `json` (mutate + reserialize, for JSON surfaces).
  - honesty rules: a gate that **passes** with a violation planted is a failure ("a gate that cannot fail is not
    a gate"); a gate that fails **without** its marker is a failure (an unrelated crash must not be mistaken for
    detection); a plant that does not restore byte-identically is a failure; a created file's new empty parent
    directories are pruned, because they show up in boundary scans.
- Profiles: `gates` is a real profile (duration budget 6s observed / 30s advisory), `ci` composes
  `full + gates + runtime + smoke`, and the failure taxonomy gains `verify.gates` with the remediation pointing
  at the harness.

## Constraints

- Probes run the wired npm scripts, never a private reimplementation of a gate's logic — the point is to prove the
  script CI actually runs is the one that fails.
- Every probe is fixed to a specific marker string; markers are part of the gate's contract.
- Restore is byte-level (sha256 comparison) and happens in `finally`, so a failing probe cannot leave a planted
  violation behind.
- `full` never plants: contract, drift, smells, config and parity gates are still exercised by their own fixtures.

## Acceptance Criteria

1. Eight probes covering every custom gate; probe metadata validated (unique gates, real markers, valid plant
   modes, targets that exist) by a fixture.
2. The honesty machinery itself is proven to fail: a command that exits 0 with a plant, a command that exits
   non-zero without the marker, and a command that exits non-zero with the marker (fixtures).
3. Plant → run → restore leaves the tree byte-identical and removes created files **and** their empty parents
   (fixtures).
4. All eight gates bite on the real tree, in one `npm run verify:gates` run.
5. `npm run verify:ci` is green with the `gates` profile composed, and the parity manifest flips
   `gates.honesty-meta` to `present`.

## Steps

- [x] probe table (eight gates), plant modes, marker assertions, byte-level restore + pruning
- [x] `scripts/gates/check.test.mjs` (metadata, machinery-can-fail, restore round-trip)
- [x] `gates` profile + `ci` composition + taxonomy entry + profile fixture updates + duration budget
- [x] `npm run verify:gates` green (8/8), `verify`, `verify:ci` green, bookkeeping + commit

## Decision Log

- 2026-10-12: probes run the wired scripts through `npm run --silent <gate>`. -> a harness that reimplements a
  gate's rules proves nothing about the gate CI runs.
- 2026-10-12: `gates` is its own profile, composed by `ci` only. -> planting violations is not something a human's
  `npm run verify` should do silently; `npm run verify:gates` is the explicit entry.
- 2026-10-12: three probes were fixed by their own first run, which is the harness working: the duplication marker
  had drifted (`unallowlisted` -> `actionable`), the budget probe planted `process.env` (budget's rule is the raw
  `env.JOBS` binding, not `process.env`), and the smells probe planted a job module without `defineJob(`. Each fix
  aimed the probe at the gate's real contract.
- 2026-10-12: created-parent pruning was added after a probe left an empty `src/features/probe-gate/` behind and
  the boundary-zones fixture caught it. -> the honesty suite must leave no trace, and the fast profile is what
  proved it.

## Verification

```bash
node --test scripts/gates/check.test.mjs   # 4 fixtures: probe metadata; the machinery fails a gate that cannot
                                           # fail and one that fails without its marker; restore + creation pruning
npm run verify:gates                       # 8/8 gates bite, tree restored, ~6s
npm run verify                             # fast profile green (no probes in human-facing runs)
npm run verify:ci                          # ci profile green: full + gates + runtime + smoke
git status --porcelain                     # only intended files; src/features holds auth/ and users/ only
```

## Completion Notes

Batch A closes with the honesty suite biting on all eight custom gates in about six seconds. The build was
self-correcting three times over — each time the harness reported that a probe could not fail, the probe was
wrong, not the gate (a drifted marker, a plant outside budget's actual rule, a job module without `defineJob(`).
One genuine gap surfaced only because the wired fast profile ran afterwards: probes that create files left empty
directories behind, which the boundary-zones fixture caught; restore now prunes them. Exit gate for batch A:
`npm run verify`, `npm run verify:gates` and `npm run verify:ci` all green, with the parity manifest at 21 of 46
rows `present`.
