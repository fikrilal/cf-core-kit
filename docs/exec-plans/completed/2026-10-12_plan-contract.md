# Plan contract (harness parity C10)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.1 (row 5.1), §5.5.1 (plan template), §7 batch C; ADR-0011 (a gate that cannot fail is not a gate)

## Objective

Open batch C by making the exec-plan corpus machine-checkable: the plan contract that the task machine, the
lanes and the handoff all read is now validated as the **first** step of the `fast` and `full` profiles.

## Behaviour reference (backend-core-kit)

`knowledge/knowledge-check.ts`: plan schema, status ↔ folder agreement, unique task ids, no unchecked boxes in
completed plans, at most one active plan, and the §5.5.1 metadata block (Task ID, Risk, Maximum risk, Authority,
Repair limit, Task timeout, Impact areas, Allowed paths, Allowed actions).

## Design

- `tools/cfkit/plans.ts` behind `cfkit plans check` / `npm run plans:check`, first step of `fast` and `full`
  (the family calls it `knowledge check`; our vocabulary is plans, so the command is `plans check`).
- Every plan (any folder): the task id comes from `- Task ID:` or, absent that, the file name — **the slug**, so
  `2026-10-12_harness-core.md` is task `harness-core`; ids must be unique kebab-case, 3-80 characters. `- Status:`
  must match the folder, `## Objective` and `## Verification` must be present, and completed plans must not
  carry unchecked execution steps. At most one plan may live in `active/`, and an absent `active/` is a
  legitimate state (no plan in flight).
- Plans that are still moving (`active`/`queued`) additionally carry the full §5.5.1 metadata: every key
  present, `Risk` and `Maximum risk` from the risk vocabulary with risk ≤ maximum, `Authority` including
  `edit` and `verify` and nothing outside the known set, `Repair limit` a non-negative integer, `Task timeout`
  of the form `Ns|Nm|Nh` within the 24 h ceiling, and non-empty `Allowed paths`.
- `_template.md` carries the metadata block (the fixture asserts the template has every key, so the contract
  cannot drift from the template it claims to enforce).

## Constraints

- **Grandfathering, recorded.** The completed corpus predates this contract. Metadata was _not_ back-filled:
  `Authority`, `Repair limit` and `Allowed paths` were never agreed for those plans, and inventing them after
  the fact would be worse than requiring them for new work. The contract binds active/queued plans; every plan
  is held to the folder, id, section and checkbox rules.
- A missing `active/` directory must not fail the check (no plan in flight), but a _present_ plan that
  disagrees with its folder must.
- Unchecked boxes under `## Follow-Ups` are recorded debt — the template asks for them — so the rule binds the
  execution sections only. This was a real finding: the strict corpus-wide rule failed 14 completed plans that
  were using the template as designed.

## Acceptance Criteria

1. The whole corpus (65 plans) validates, and the template carries every metadata key (fixtures).
2. Status/folder mismatch, duplicate or malformed ids, a second active plan, a missing required section, a
   missing metadata key, a bad risk/authority/timeout/repair-limit value and a risk above its maximum are each
   rejected with a precise message (fixtures).
3. Unchecked execution steps are rejected in completed plans, while unchecked follow-ups are accepted (fixtures).
4. A live probe (a completed plan temporarily declared `active`) fails with its marker and reverts green.
5. `npm run verify`, `npm run verify:gates` and `npm run verify:ci` are green with `plans:check` first in the
   `fast` profile, and `knowledge.plan-contract` flips to `present` (28 of 46).

## Steps

- [x] `tools/cfkit/plans.ts` (parser, validator, summary) + `plans check` + USAGE + `plans:check`
- [x] first step of `fast` and `full`, taxonomy code `verify.plans`, profile fixture update
- [x] fixtures (10) + `test:scripts` registration
- [x] the two structural fixes the contract exposed in the corpus (see the decision log)
- [x] template + README contract documentation, probe, manifest flip, bookkeeping

## Decision Log

- 2026-10-12: task id = the file-name slug, not the whole stem. -> the date prefix is when the plan was
  written, not identity; deriving `harness-core` also matches what the task machine has been using all along.
- 2026-10-12: the unchecked-box rule binds `## Steps`/`## Acceptance Criteria`/`## Completion Notes`, not
  `## Follow-Ups`. -> the first run failed 14 completed plans whose unchecked boxes were deferred work recorded
  exactly as `_template.md` asks. A rule that forbids what the template requires is a bug in the rule.
- 2026-10-12: metadata is required of active/queued plans only, and the corpus is grandfathered explicitly
  rather than back-filled. -> see Constraints; the alternative was fabricating authority and path scopes for
  work that already shipped.
- 2026-10-12: two corpus fixes were made, both structural and both recorded in the files themselves: the
  phase-5 publication plan gained a `## Verification` section quoting its own publication record, and the OTLP
  export plan gained an `## Objective` restating its own findings. No new claim was introduced.
- 2026-10-12: `plans check` rather than `knowledge check`. -> the family's command is generic; ours validates
  exec plans, and parity here is about the _contract_, not the spelling.

## Verification

```bash
node --test tools/cfkit/plans.test.ts   # 10 fixtures: corpus + template, folder/status, ids, active limit,
                                        # metadata values, sections, checkbox scoping, follow-up debt
npm run plans:check                     # [plans] active 0, queued 0, completed 65; all checks passed
# probe: declaring a completed plan `active` fails with
#   `x docs/exec-plans/completed/2026-10-12_oracles.md: - Status: "active" does not match the folder (expected "completed")`
#   and reverting restores green
npm run verify                          # fast profile green, plans:check first
npm run verify:gates                    # 8/8 gates bite
npm run verify:ci                       # ci profile green
```

## Completion Notes

The plan contract landed as the first step of `fast`, so an invalid plan is now the earliest thing a verify run
can fail on. The corpus shaped the contract in three honest ways: ids come from the slug (not the date-prefixed
stem), unchecked boxes are violations only in execution sections (14 completed plans use `Follow-Ups` exactly as
the template asks), and metadata binds active/queued plans with the completed corpus grandfathered rather than
back-filled. Two corpus files gained a missing structural section, each quoting its own existing record.
