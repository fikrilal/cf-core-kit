# Operating-evidence ledger (harness parity C12)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.5 (row 5.5), §5.8 (the programme it gates), §7 batch C

## Objective

Record _reviewed_ proof of hosted verification in a ledger that cannot hold anything else — and make the
improvement programme's eligibility visible instead of assumed.

## Behaviour reference (backend-core-kit)

`docs/engineering/operating-evidence-ledger.json` (schema 1, empty), `evidence check`, entries requiring hashed
episodes, human review, the exact 40-character revision and a hosted-CI run URL, plus advisory eligibility
(5 reviewed tasks, 2 risk classes, >= 1 repair or escalation) reported as a shortfall list.

## Design

- `docs/engineering/operating-evidence-ledger.json` — schema 1, `entries: []`, empty **by design** (eligibility
  is unmet, so the machinery that consumes it stays disabled by construction).
- `docs/engineering/operating-evidence.md` — the promotion contract: the field table, the rule that there is no
  free-text field at all, the review rule (reviewer must not be the author; a process rule the checker cannot
  verify, recorded as such), the eligibility thresholds and how an entry is added.
- `tools/cfkit/evidence.ts` behind `cfkit evidence check` / `npm run evidence:check` (a `full`-profile step,
  taxonomy code `verify.evidence`):
  - per-entry validation: kebab `taskId`, `risk`/`lane`/`outcome` from their vocabularies, a short reviewer
    handle, a hosted CI run URL (GitHub Actions run or GitLab pipeline), a sha256 `episodeHash`, a 40-character
    `revision`, a `YYYY-MM-DD` review date, integer counts with `escalations <= attempts` and an `escalated`
    outcome requiring at least one escalation;
  - structural anti-prose/anti-PII rules: unknown keys are rejected, and any value containing an address or a
    line break is rejected, so prose and personal data have nowhere to live;
  - unique task ids; a 256 KiB ledger cap; `eligibilityShortfall` (5 tasks / 2 risk classes / 1 repair or
    escalation) printed on every run.

## Constraints

- The ledger is advisory: eligibility gates the improvement programme (§5.8) and never blocks a change.
- An entry must be expressible in the schema; anything else belongs in a plan, an ADR or a PR description.
- Reviews are a human act: the checker requires the field and cannot verify who typed it — the gap is documented
  in the contract rather than papered over.
- The ledger stays empty until real hosted runs exist; seeding it with invented entries would defeat its only
  purpose.

## Acceptance Criteria

1. The shipped ledger validates, is empty, and sits inside the 256 KiB cap (fixture).
2. A complete entry validates, including a GitLab pipeline URL and an escalated entry (fixtures).
3. Unknown keys, addresses, line breaks, bad ids/handles/hashes/revisions/dates/lanes/outcomes/URLs and
   inconsistent counts are each rejected with a precise message (fixtures).
4. Duplicate task ids, a wrong schema version and an oversized ledger are rejected (fixtures).
5. Eligibility reports a three-item shortfall on an empty ledger and clears on a satisfied one (fixtures).
6. A live probe (an entry with prose, an address, a bad handle and a non-hosted URL) fails with all four
   markers and reverting restores green.
7. `npm run verify`, `npm run verify:gates` and `npm run verify:ci` are green with `evidence:check` in the full
   profile, and `evidence.operating-ledger` flips to `present` (30 of 46).

## Steps

- [x] ledger + contract document + `docs/README.md` navigation entry
- [x] `tools/cfkit/evidence.ts` (parse/validate/eligibility/report) + `evidence check` + `evidence:check`
- [x] `full`-profile step, taxonomy code, profile fixture, `test:scripts` registration
- [x] 9 fixtures, live probe, manifest flip, bookkeeping

## Decision Log

- 2026-10-12: no free-text field exists in the schema. -> "forbids prose/PII" is stronger as a shape than as a
  regex over a `notes` field; an entry that cannot be expressed in ids, enums, hashes, a revision, a URL and
  dates is not evidence, it is commentary.
- 2026-10-12: the ledger stays empty. -> eligibility is unmet and the honest state is "no hosted run has been
  reviewed yet"; seeding it would make the gating that consumes it meaningless.
- 2026-10-12: the review rule is documented as a process rule the checker cannot verify. -> `reviewedBy` proves
  the field was filled, not that a second person read the episode; saying so is better than implying the check
  proves more than it does.
- 2026-10-12: eligibility shortfalls are printed on every run, not only when the ledger is queried. -> the
  consumer of this signal (§5.8) is disabled, so silence would read as "eligible".
- 2026-10-12: run URLs are shape-checked against GitHub Actions and GitLab pipelines. -> a hosted lane is the
  point; a bare domain with a path is not evidence of one.

## Verification

```bash
node --test tools/cfkit/evidence.test.ts   # 9 fixtures: shipped ledger, a complete entry, prose/unknown keys,
                                           # addresses, every shape rule, counts, uniqueness, schema/cap, eligibility
npm run evidence:check                     # entries 0; eligible no + the three shortfall lines; all checks passed
# probe (recorded): an entry with a `notes` field, `reviewedBy: sam@example.com`, a bare-domain run URL and a
#   non-hosted URL was rejected four times over ->
#     x entries[0].notes is not a ledger field (no prose belongs here)
#     x entries[0] contains an address or a line break
#     x entries[0].reviewedBy must be a short handle (not a name, not an address)
#     x entries[0].ciRunUrl must be a GitHub Actions or GitLab pipeline run URL
#   and reverting restored green
npm run verify                             # fast profile green
npm run verify:gates                       # 8/8 gates bite
npm run verify:ci                          # ci profile green with evidence:check in the full profile
```

## Completion Notes

The ledger landed empty with a contract that makes prose and PII structurally impossible: every field is an id,
an enum, a hash, a revision, a URL or a date, unknown keys are rejected, and address-like values are rejected
outright. Eligibility prints a three-item shortfall on every run, so the disabled improvement programme (§5.8,
plan F20) is disabled by construction rather than by convention. One honest limit is recorded in the document and
the plan: `reviewedBy` cannot be shown to be someone other than the author — that part of the promotion contract
stays a human act, and the checker says so instead of implying otherwise.
