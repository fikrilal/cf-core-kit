# The duplication harness

Two jscpd profiles, two allowlists, one generator. The profiles exist because "duplication" means two different
things here: a large clone is a design problem, a small repeated helper is a tuning backlog.

| Profile         | Threshold           | Scope                | Fatality                                                              | Allowlist                                       |
| --------------- | ------------------- | -------------------- | --------------------------------------------------------------------- | ----------------------------------------------- |
| `core`          | 60 tokens / 7 lines | the whole repository | **fatal** (`duplication:check`, runs in the `ci` profile)             | `tools/duplication-allowlist.json`              |
| `small-helpers` | 24 tokens / 4 lines | `src/**`             | report-only (`duplication:small-helpers`, `--fatal-found` to enforce) | `tools/small-helper-duplication-allowlist.json` |

`duplication:report` runs both and writes the gitignored `_WIP/duplication-report.md`.

## Categories

Clones are grouped so the report leads with the repeated _pattern_ rather than a file list: query builders, rate
limiting, queue and jobs, request pipeline, route wiring, clock and duration, error mapping, test support. A
clone that matches no category stays visible in an `uncategorized` section — dropping it would make the report
quietly incomplete.

## Why the small-helper profile is scoped to `src/**`

Scanning `scripts/**` produced 44 entrypoint-boilerplate clones (`isDirectRun` guards, argument parsing): the
same guard repeated fourteen times buries the signal the profile exists to surface. The core profile keeps the
whole repository because that is where its 60-token threshold is meaningful.

## Allowlists

An entry is a reviewed pair with a reason:

```json
{
  "reason": "Standalone script entrypoint boilerplate; each check script must stay individually runnable.",
  "files": ["scripts/budget/check.mjs", "scripts/drift/check.mjs"]
}
```

Both files are named, and a pair only half-covered is still a violation — a group cannot silence a clone that
touches a file it does not mention. `remove feature` prunes entries whose paths are gone (see
`baseline-pruner.ts`), so an allowlist cannot outlive the code it excused.

## Policy

The core profile is fatal because a 60-token clone is usually a missing module. The small-helper profile is
report-only with `--fatal-found` reserved, because 119 actionable clones in current product code are route
definitions and job-logging shapes — a tuning backlog, not a defect count. When that backlog is paid down, the
flag is how the profile becomes a gate; until then, the report is the honest artifact.
