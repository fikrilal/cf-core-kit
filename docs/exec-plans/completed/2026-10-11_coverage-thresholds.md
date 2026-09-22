# Coverage thresholds recorded (roadmap follow-up)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0011 (strict quality baseline and gate honesty); roadmap Phase 6 follow-up

## Objective

Record coverage thresholds once the surface has stabilized: measure the suite's real coverage
through the Workers pool, set conservative thresholds just below the measurement, wire the
measurement as a profile step, and document what the number does and does not prove.

## Design

- `@vitest/coverage-v8` (the provider matching the pool) with `coverage.include: ["src/**"]`
  and the spec files excluded; thresholds for statements/branches/functions/lines set a few
  points below the measured baseline so the gate is a floor, not a ratchet that breaks on
  refactors.
- The measurement runs as a step in the `full` profile (and therefore `ci`): coverage output
  is text-only (`coverage/` stays gitignored), and the step id is stable (`test:coverage`).
- Honesty note for the standard/plan: line coverage over `src/**` counts platform and feature
  code together; it proves the suite reaches the surface, not that behavior is pinned — the
  behavioral gates remain the specs and the contract suite.

## Acceptance Criteria

1. Baseline measured and recorded in this plan with the exact command.
2. Thresholds set below the baseline; a probe (threshold raised above the measurement) fails
   and is recorded.
3. `test:coverage` runs inside `full`/`ci`; `verify:ci` green with the step.

## Steps

- [x] Provider + config + baseline measurement
- [x] Thresholds + profile wiring + probe + bookkeeping

## Decision Log

- 2026-10-11: thresholds as a floor below the baseline. -> coverage gates exist to catch drift, not to force test-writing for its own sake
- 2026-10-11: text reporter only. -> HTML artifacts are local debugging aids; CI keeps them out of the tree

## Verification

```bash
npm run test:coverage
# baseline (Workers pool, v8 provider, src/** minus specs):
#   Statements 88.58% (1599/1805)   Branches 82.45% (959/1163)
#   Functions  94.01% (361/384)     Lines    91.85% (1489/1621)
# thresholds set as floors below the baseline: statements 85, branches 78, functions 90,
#   lines 88
# probe: raising statements to 95 fails with "ERROR: Coverage for statements (88.58%) does not
#   meet global threshold (95%)"; restored -> green
# step duration: ~53s; wired into full (and therefore ci); observed baselines recalibrated
#   (full 120s, ci 165s against their advisory ceilings)
npm run verify:ci   # ci profile green with the coverage step
```

## Completion Notes

The gate is a floor, not a ratchet: the thresholds sit a few points under a real measurement so
they catch drift (a phase of work quietly deleting tests or adding unwired code) without
turning every refactor into a numbers game. Coverage runs inside the `full` profile only — the
`fast` developer loop stays fast. What the number does and does not prove is recorded here
deliberately: line coverage over `src/**` shows the suite reaches the surface; it does not show
that behavior is pinned, which remains the job of the specs and the contract suite. The provider
version is pinned to vitest's (both 5.0.3), and coverage artifacts stay out of the tree
(text-summary reporter; `coverage/` is gitignored).
