# Sensors: architecture smells (harness parity A4)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.2 (row 2.5), §7 batch A; ADR-0011 (gate honesty)

## Objective

Fourth plan of batch A: the architecture smell scanner — a small rule set with precise semantics, a
reviewed baseline, a generated report, and a high-severity floor — for the traps this repository has
actually hit and that no other gate owns.

## Behaviour reference (backend-core-kit)

- `scripts/architecture-smells.ts`: severity `high|medium|low`, `--report _WIP/architecture-smells.md`,
  `--baseline tools/architecture-smells.baseline.json`, `--ci` failing only on **new** findings at or above a
  floor (default `high`), baseline writes refused unless `ARCH_SMELLS_BASELINE_APPROVED=true`, and a
  `docsLink` per rule so a finding explains where the rule comes from.

## Design

- `scripts/smells/check.mjs` (`smells:check`, a full-profile step; `smells:report` writes the report;
  `smells:baseline` writes the baseline behind the approval env):
  - rules (each with id, severity, description, docsLink, and a fixture that makes it fire):
    `uncomposed_job_module` (high) — a module calling `defineJob` must be imported by `src/jobs.ts`, or the
    job can never run; `raw_error_code_literal` (medium) — error-code string literals outside the enum;
    `wall_clock_in_feature` (medium) — `new Date()`/`Date.now()` in `src/features/**`; `console_usage_outside_logger`
    (medium) — console output outside `src/platform/logging/`; `untracked_todo` (low) — TODO/FIXME/XXX/HACK in src.
  - scans the **working tree**, not the index, so a file is checked before it is staged; the baseline is
    `{ schemaVersion: 1, keys: [] }` (`tools/smells-baseline.json`), keys are `rule:file`, and the report lands
    in the gitignored `_WIP/architecture-smells.md`.
  - the severity floor defaults to `high` (family parity); medium and low findings stay visible in the report
    and in the run summary without failing the profile.
- Explicitly not duplicated from other gates: env confinement (budget scan), `x-error-codes` presence
  (Spectral), file length (eslint `max-lines`), `any`/assertions (eslint), wall-clock lint for features was
  **moved here from plan B7** so the property has one owner.

## Constraints

- A rule earns its place only when its semantics are precise enough to gate on. A "batch queries must be
  bounded" rule was written, evaluated and **dropped**: a keyed delete is already bounded, and regexes cannot
  distinguish keyed from unbounded deletes without false positives (recorded in the module header).
- The scanner is read-only except for the report and the approval-gated baseline write.
- Every rule ships a fixture that proves it fires and a clean-tree fixture that proves it stays quiet.

## Acceptance Criteria

1. Six rules with well-formed metadata (unique ids, severities, descriptions, docsLinks), each proven to fire
   by a fixture and to stay quiet on clean input (fixtures).
2. The repository scans clean, and the shipped baseline is valid and empty (fixtures).
3. Baseline suppression, the severity floor, malformed-baseline rejection and a missing baseline all behave as
   specified (fixtures).
4. A planted high-severity violation (an orphan job module) fails `smells:check` with a precise marker; removing
   the file restores green (probe).
5. `npm run verify:ci` stays green with `smells:check` in the full profile; the parity manifest flips
   `sensors.smells` to `present`.

## Steps

- [x] `scripts/smells/check.mjs` (rules, scanner, baseline, report, floor, approval-gated writes)
- [x] `tools/smells-baseline.json` + gitignored report path
- [x] `scripts/smells/check.test.mjs` (12 fixtures incl. rule-fires, rule-quiet, baseline semantics)
- [x] full-profile wiring + taxonomy entry (`verify.architecture`) + profile fixture update
- [x] probe, `verify:ci`, manifest flip, bookkeeping

## Decision Log

- 2026-10-12: five rules, not thirteen. -> the family's rule set targets Nest/Prisma/Redis shapes; porting
  rules that can never fire here would be theater, and the four properties we do enforce elsewhere (env
  confinement, x-error-codes, file length, `any`) stay owned by their existing gates.
- 2026-10-12: the batch-query rule was dropped after a live evaluation. -> it flagged keyed deletes
  (`where(eq(id, ...))`) as unbounded; a gate that noisy trains people to baseline everything.
- 2026-10-12: the scanner walks the working tree. -> the first probe was invisible because the file was
  untracked; a local gate must see uncommitted work.
- 2026-10-12: the wall-clock rule lives here, not in plan B7. -> one owner per property; B7 keeps tiers,
  helpers, env isolation and coverage reporters.

## Verification

```bash
node --test scripts/smells/check.test.mjs   # 12 fixtures: rule metadata, each rule fires, rules stay quiet,
                                            # baseline suppression/floor, malformed and missing baseline, repo clean
npm run smells:check                        # findings 0; all checks passed
# probe: creating src/features/auth/orphan-probe.jobs.ts (a defineJob module src/jobs.ts does not import)
#   fails with `x uncomposed_job_module (high) ... does not import ./features/auth/orphan-probe.jobs`; removal restores green
npm run smells:report                       # writes _WIP/architecture-smells.md (gitignored)
npm run verify:ci                           # ci profile green with smells:check in the full profile
```

## Completion Notes

The scanner landed with five precise rules, a validated empty baseline, a generated report and a
high-severity floor. Two findings were folded back into the design rather than hidden: the batch-query rule
was dropped after it produced false positives on keyed deletes, and the first probe exposed that the scanner
was reading the git index instead of the working tree (fixed, since a local gate must see uncommitted work).
The wall-clock property moved here from plan B7 so it has exactly one owner; the proposal's B7 row is
updated accordingly at the next bookkeeping pass (`docs/exec-plans/roadmap.md` records the move).
