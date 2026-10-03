# Sensors: duplication profiles (harness parity A5)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.2 (row 2.6), §7 batch A; ADR-0011 (gate honesty)

## Objective

Fifth plan of batch A: the second duplication profile. The core profile (60 tokens) stays fatal; a
small-helper profile (24 tokens / 4 lines) makes repeated small helpers visible in product code without
blocking on the tuning backlog, and both profiles render a categorised report.

## Behaviour reference (backend-core-kit)

- Two jscpd profiles, `jscpd:core` (60/7) and `jscpd:small-helpers` (24/4), each with its own allowlist and
  `--fatal-found` switch; a filter script categorises clones (error mapping, query builders, cursor/filter/sort,
  rate limiter, retry/backoff, queue envelope, request trace, date/time) and writes markdown reports under
  `_WIP/`, with uncategorised clones excluded from the actionable list.

## Design

- `scripts/duplication/check.mjs` gains a profile table: `core` (60 tokens / 7 lines, `**/*.{ts,mjs,js}`,
  fatal, `tools/duplication-allowlist.json`) and `small-helpers` (24 tokens / 4 lines, `src/**/*.ts`,
  report-only unless `--fatal-found`, `tools/small-helper-duplication-allowlist.json`).
  `npm run duplication:check` keeps its exact previous meaning; `duplication:small-helpers` is the new
  profile; `duplication:report` runs both and writes the gitignored `_WIP/duplication-report.md`.
- The family's behaviour is otherwise kept: reviewed allowlist entries carry a reason and both files,
  clones are described as `<a> <-> <b> (lines, tokens)`, and the report groups clones by category with a
  description so it leads with the repeated pattern rather than a file list.
- Deviations, recorded: the report **keeps** uncategorised clones in their own section instead of filtering
  them out (hiding them would make the report quietly incomplete), and the small-helper profile is scoped to
  `src/**` — scanning `scripts/**` produces 44 extra boilerplate clones from `isDirectRun` guards and arg
  parsing, which is exactly why the family scopes its profile to libraries and worker jobs.

## Constraints

- The small-helper profile is **report-only** at this stage: it is a tuning backlog, not a gate
  (`--fatal-found` exists for the day the backlog is paid down).
- The core profile's meaning must not change: same threshold, same allowlist, same fatality.
- Profile scoping and thresholds are recorded in the module, and the report is generated, never hand-edited.

## Acceptance Criteria

1. Both profiles resolve; the core profile keeps its threshold and fatality, the small-helper profile is
   non-fatal with a lower floor (fixtures).
2. A planted small clone is caught by the small-helper profile and deliberately ignored by the core profile —
   proving the thresholds differ (fixtures).
3. A reviewed allowlist entry suppresses a small-helper clone (fixtures).
4. The report renders both profiles, categorises clones, lists allowlists, and keeps uncategorised clones
   visible (fixtures).
5. `npm run duplication:check` is green on the real tree; `duplication:report` writes the report; the parity
   manifest flips `sensors.duplication-small-helpers` to `present`.

## Steps

- [x] profile table, per-profile pattern/threshold/allowlist/fatality
- [x] categories + `categorizeClone` + categorised report + `duplication:report` wiring
- [x] `tools/small-helper-duplication-allowlist.json`
- [x] fixtures (thresholds, suppression, report rendering, category mapping)
- [x] probe, `verify:ci`, manifest flip, bookkeeping

## Decision Log

- 2026-10-12: the small-helper profile scans `src/**`, not the whole repo. -> the first run reported 163
  clones, 44 of them `scripts/**` entrypoint boilerplate; counting the same guard fourteen times buries the
  signal it exists to surface.
- 2026-10-12: uncategorised clones stay in the report. -> the family filters them out of the actionable list;
  silently dropping a third of the findings is worse than an honest "not yet categorised" section.
- 2026-10-12: report-only, with `--fatal-found` reserved. -> there are 119 actionable small-helper clones in
  current product code (7.5% of lines) and they are overwhelmingly route-definition and job-logging shapes;
  gating on that today would demand a rewrite of healthy code rather than signal a defect.

## Verification

```bash
node --test scripts/duplication/check.test.mjs   # 10 fixtures: violation text, categories, profile policy,
                                                 # threshold divergence (small sees it, core ignores it),
                                                 # allowlist suppression, report rendering
npm run duplication:check                        # core: 1 clone, allowlisted 1, actionable 0
npm run duplication:small-helpers                # 119 actionable clones, report-only, exit 0
# probe: adding src/features/probe-{a,b}/probe.ts with a shared 7-line/71-token helper raised the count to 120
#   and listed the pair by name; removing both files returned it to 119
npm run duplication:report                       # writes _WIP/duplication-report.md with 7 category sections
npm run verify:ci                                # ci profile green with duplication:report in the full profile
```

## Completion Notes

The second profile landed with categories, a categorised report and its own reviewed allowlist, while the
core profile kept its exact previous meaning (still 1 clone, the allowlisted entrypoint boilerplate). Two
findings shaped the design: the profile had to be scoped to product code (script boilerplate produced 44
noise clones), and the report keeps uncategorised clones visible rather than filtering them, because
dropping a third of the findings silently is worse than an honest section. The 119 actionable clones are
recorded as a tuning backlog, not a defect count, and `--fatal-found` is the switch that turns this
visibility into a gate once the backlog is paid down.
