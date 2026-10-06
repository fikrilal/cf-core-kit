# Mutation pilot (harness parity B9)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.3 (row 3.11), §7 batch B; ADR-0011 (sensors are not proof)

## Objective

Close batch B by answering one question mechanically: do the assertions around our risk and budget policy
actually detect a change in that policy? A seeded mutation catalogue, run locally and never in a profile.

## Behaviour reference (backend-core-kit)

A Stryker pilot over one pure file with thresholds 80/60/70, never wired into the profiles. Stryker's runners do
not match our Workers pool, so the family's _engine_ does not port; the family's _question_ does.

## Design

- `scripts/mutation/pilot.mjs` (`npm run test:mutation`): a seven-entry catalogue across two pure policy files —
  `tools/cfkit/risk-classifier.ts` (four mutations: raise-only neutered, unknown-default renamed, first-match
  policy reversed, runtime reason renamed) and `tools/cfkit/duration-policy.ts` (three: advisory neutered,
  boundary flipped, observed baseline dropped) — each paired with the spec that must fail.
- Per mutation: apply, run `node --test <spec>`, restore byte-identically (sha256 verified in a `finally`).
  A passing spec is a **survivor** and fails the run; the report lands in the gitignored
  `.cfkit/mutation/report.json`.
- Fixtures cover the machinery itself: catalogue validity (unique ids, anchors present, descriptions, spec
  files exist), byte-identical apply/restore, survivor-versus-killed with an injected runner, report shape, and
  a drifted anchor being rejected.
- Deviation recorded: the family's Stryker thresholds allow survivors; ours requires **all seven** seeded
  mutations killed, because a hand-picked catalogue with a survivor budget would be a budget for a lie.

## Constraints

- The pilot edits real sources, so it is never in a verify profile and never in CI's default path; the fixture
  only exercises it with an injected runner for the survivor/killed cases and once against the real catalogue.
- Anchors are exact strings: a refactor that moves the code fails the catalogue validation loudly rather than
  silently mutating nothing.
- A mutation must change behaviour; the catalogue is reviewed, not generated.

## Acceptance Criteria

1. The catalogue validates (unique ids, anchors present, spec files exist) and all seven are killed (fixtures +
   run).
2. Apply/restore is byte-identical, and a drifted anchor is rejected (fixtures).
3. Survivors are reported and fail the run (fixture with an injected runner).
4. The first real run found a genuine survivor and the plan **fixed the assertion**, not the mutation.
5. `npm run verify`, `npm run verify:gates` and `npm run verify:ci` stay green with `test:mutation` outside every
   profile, and `test.mutation-pilot` flips to `present` (27 of 46).

## Steps

- [x] `scripts/mutation/pilot.mjs` (catalogue, applier, runner seam, report)
- [x] `scripts/mutation/pilot.test.mjs` (5 fixtures) + `test:scripts` registration + `npm run test:mutation`
- [x] the survivor found by the first run fixed at its source (assertion, not mutation)
- [x] testing-standard section, manifest flip, bookkeeping

## Decision Log

- 2026-10-12: a hand-written catalogue instead of Stryker. -> Stryker's runners do not match the Workers pool,
  and re-implementing its engine would answer a different question; seven recorded mutations over two policy
  files answer ours.
- 2026-10-12: no survivor budget. -> the family allows 20% (Stryker 80/60/70); with a hand-picked catalogue a
  survivor budget would just be permission to leave an assertion out.
- 2026-10-12: the runner is injectable (`command`/`argsFor`). -> the fixture must be able to prove "a passing
  spec is a survivor" without shipping a deliberately weak spec in the repository.
- 2026-10-12: the fixtures never mutate real sources, and `runPilot` takes an injected catalogue. -> the first
  version ran the shipped catalogue from inside `test:scripts`, which executes spec files **concurrently**:
  the pilot mutated `tools/cfkit/risk-classifier.ts` while `tools/cfkit/risk-classifier.test.ts` was being run
  by a sibling worker, and `test:scripts` failed with "runtime reasons: sorted, unique and table-driven". The
  fixtures now run against a temp copy with an injected runner, and the shipped catalogue only ever runs under
  `npm run test:mutation`.
- 2026-10-12: **the pilot's first run found a survivor** — `risk.unknown-default-renamed` survived because the
  classifier spec asserted the unknown rule id through the `UNKNOWN_RULE_ID` constant, so renaming the constant
  kept the spec green. -> fixed by pinning the literal `"medium.unknown"` (it is the id the CI annotation and
  reports carry, i.e. vocabulary, not an implementation detail) and by asserting it through `effectiveRisk` too.
  This is the plan paying for itself on day one.

## Verification

```bash
node --test scripts/mutation/pilot.test.mjs   # 5 fixtures: catalogue, byte-identical restore, survivor vs
                                              # killed, report, drifted anchor
npm run test:mutation                         # 7/7 seeded mutations detected; report in .cfkit/mutation/
npm run test:mutation -- --list               # prints the catalogue
# probe (recorded): temporarily replacing a mutation's payload with a no-op produced a SURVIVED line, the
#   survivor list and exit 1; reverting restored 7/7
npm run verify                                # fast profile green (pilot outside every profile)
npm run verify:gates                          # 8/8 gates bite
npm run verify:ci                             # ci profile green
```

## Completion Notes

The pilot landed with seven mutations across the two policy files and — better than the acceptance criteria
asked for — it found a real gap on its first run: the unknown-rule id was only ever asserted through the
constant itself, so a rename was invisible. The assertion now pins the literal id, and the pilot reports 7/7.
Two findings shaped it beyond the acceptance criteria: the first run left a survivor (fixed at the assertion),
and the first fixture design mutated real sources from inside a concurrently run `test:scripts`, which flaked
the classifier spec — fixtures now use temp copies and an injected runner, and only `npm run test:mutation`
touches the real files. Batch B is complete: `test-ergonomics`, `oracles` and `mutation-pilot` all landed, the
parity manifest sits at 27 of 46 `present`, and the exit gate (`verify`, `verify:gates`, `verify:ci` plus the
local pilot) is green with 191 script fixtures passing.
