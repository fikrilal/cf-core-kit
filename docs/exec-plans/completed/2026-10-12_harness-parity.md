# Harness parity: the family tree comparison and the improvement gating (F20)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.6 (row 5.8), §7 batch F (item 10), the manifest A1 created

## Objective

Close the programme: make the parity claim traceable to the family's own tree, and land the improvement
programme with its gating rather than its optimism — machinery present, disabled until the operating evidence
makes it meaningful.

## Behaviour reference (backend-core-kit)

`tools/backendkit/improvement/` (an improvement ledger with `proposed → approved → evaluating → kept | reverted`,
the invariants, an approver distinct from the owner, a harness-scoped authority) and the family tree comparison
the manifest is written against.

## Design

- `tools/parity/family-map.json` records, for **each of the 46 manifest rows**, the family artifact it was ported
  from (path plus `file`/`dir`), with a reason for every recorded deviation (`familyPath: null`). It was built by
  reading the family checkout rather than from memory.
- `scripts/parity/tree.mjs` (`npm run parity:tree`, a `full`-profile step) validates the map against our own
  manifest offline, and with `--family <path>` validates every recorded path against the real family tree —
  existence _and_ kind. The live run verified all 43 recorded paths against `/…/backend-core-kit`.
- `tools/cfkit/improvements.ts` (`npm run improve:check`, a `full`-profile step): the improvement ledger
  (`docs/engineering/improvements-ledger.json`, schema 1, empty), the five invariants, the approver-differs-from-
  owner rule, the harness-only edit surface (`tools/cfkit/**`, `scripts/**`, `docs/engineering/**`, `docs/adr/**`,
  `docs/exec-plans/**`, `.github/workflows/**`, `package.json`, `package-lock.json`), authority exactly
  `edit, verify`, and the gate: `improve analyze` and `improve shadow` answer **ineligible** with the
  operating-evidence shortfall (5 reviewed tasks, 2 risk classes, one repair or escalation) and exit non-zero.
- `docs/engineering/improvements.md` is the contract (the gate, the entry fields, the invariants table, the
  surface, the shadow-window rule, and "what exists today").

## Constraints

- The parity claim is traceable or it is not made: every row maps to a path, and a deviation says why.
- The improvement programme is disabled by construction, not by convention: eligibility is computed from the
  operating-evidence ledger, which is empty.
- An improvement cannot approve itself, and it cannot edit the product surface or the normative standards — the
  surface rules are validated, not documented only.
- `parity:tree` must be useful offline (CI has no family checkout) and stronger with one; the fixture asserts both.

## Acceptance Criteria

1. The map covers every manifest row, its recorded deviations carry a reason, and the offline validation passes
   (fixtures).
2. A foreign row id, a wrong kind, an unexplained null, an empty path and a thin map are each refused (fixtures).
3. The live comparison passes against the family checkout when one is provided (fixture, gated on `FAMILY_ROOT`).
4. The improvement ledger validates; the approver rule, the statuses, the invariants, the surface paths and the
   `evaluatedOn` requirement are each enforced (fixtures).
5. `improve analyze` reports the shortfall and refuses while ineligible (live run).
6. `npm run verify`, `npm run verify:gates` and `npm run verify:ci` are green, and `parity.tree-check` plus
   `evidence.improvement-gating` flip to `present` — **46 of 46 rows**.

## Steps

- [x] the family map (46 rows, built from the family checkout) + `scripts/parity/tree.mjs` + the profile step
- [x] `tools/cfkit/improvements.ts` + the empty ledger + `docs/engineering/improvements.md` + the profile step
- [x] fixtures (4 improvement validation cases, 3 tree cases) + `test:scripts` registration
- [x] the live tree comparison, the final manifest flips, bookkeeping

## Decision Log

- 2026-10-12: the map is data, built by reading the family tree. -> my first version guessed paths and row ids;
  the live comparison rejected five of them immediately, which is exactly the check working — a remembered path
  is a claim, and claims get validated.
- 2026-10-12: deviations are `null` with a reason, not omitted rows. -> three rows have no family counterpart
  (the assertion helpers and env isolation live outside the ported surface, and the tree comparison is ours); a
  missing row would have looked like an oversight.
- 2026-10-12: a thin map is a finding, not an early exit. -> the first fixture could not see the entry-level
  checks because the count check returned first; validating what exists is the point.
- 2026-10-12: `analyze`/`shadow` exit non-zero while ineligible. -> the gate is the deliverable; a programme that
  runs on unreviewed evidence would be guessing with extra steps.
- 2026-10-12: authority is exactly `edit, verify` and the surface excludes `src/**`, `contracts/**`, `db/**` and
  `docs/standards/**`. -> the harness may improve itself, never the product or the normative standards.

## Verification

```bash
node --test tools/cfkit/improvements.test.ts scripts/parity/tree.test.mjs   # 7 fixtures: the ledger and its
  # rules, the shipped empty ledger, the gate, the map both offline and against a family checkout
npm run parity:tree                       # offline: 46 mapped rows, all checks passed
node scripts/parity/tree.mjs --family /home/fikrilal/workspace/devs/core/backend-core-kit
                                          # live: every recorded path exists with the recorded kind
npm run improve:check                     # entries 0; eligible no; the three shortfall lines; all checks passed
npm run cfkit -- improve analyze          # disabled until the programme is eligible (exit 1)
npm run verify                            # fast profile green
npm run verify:gates                      # 8/8 gates bite
npm run verify:ci                         # ci profile green
```

## Completion Notes

The programme closes with the parity claim traceable: all 46 manifest rows map to a family artifact, 43 of them
verified live against the family checkout and three recorded as deviations with reasons (mine failed the live
comparison first, which is the point). The improvement programme landed as machinery with a closed gate — an
empty ledger, validated invariants, an approver distinct from the owner, a harness-only surface and
`analyze`/`shadow` refusing with the operating-evidence shortfall. **The parity manifest stands at 46 of 46
rows present.**
