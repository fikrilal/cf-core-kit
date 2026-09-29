# Risk lanes: classifier, runtime reasons, `ci classify` (harness parity A2)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.1 (rows 1.5, 1.6, 1.9), §7 batch A; ADR-0005 (budgets), ADR-0009 (verify gate)

## Objective

Second plan of the harness-parity programme. It turns "which verification applies" into data: one risk
classifier for the whole repository, a runtime-reason table adapted to this tree, and the CI-facing
`cfkit ci classify --base --head` command whose two outputs (`effective_risk`, `runtime_required`) drive the
CI lanes in plan E17. The classifier currently lives inside `tools/cfkit/task.ts` for task lanes only; this
plan promotes it to its own module, extends it with runtime reasons and a rule-path fixture, and leaves the
task machine consuming the same single source.

## Behaviour reference (backend-core-kit)

- `policy/risk-classifier.ts`: first-match-per-path rule table, path risk = max over paths, effective risk =
  max(path risk, declared plan risk) — **risk can only be raised, never lowered**; unmatched paths are
  `medium.unknown`.
- `verification/lane-selection.ts`: static lane `fast` when low else `full`, plus the runtime lane whenever any
  impact reason matches (API, database, auth, queue, environment, external integrations, worker, critical
  HTTP paths, external adapters); reasons are sorted and unique.
- `ci/ci-classification.ts`: `git diff --name-only --diff-filter=ACMRDT <base>...<head>`, revisions validated
  as 40-64 hex characters, plan files parsed for declared risk, and exactly two machine-readable outputs
  (`effective_risk=`, `runtime_required=`) so CI can write them straight into `$GITHUB_OUTPUT`.
- The harness's own rule table once referenced a path that no longer exists (`tools/harness-policy/`), which
  silently mis-scoped lanes; A2 adds a fixture that forbids that failure mode here.

## Design

- `tools/cfkit/risk-classifier.ts` — the single source: `RISK_RULES` (id, risk, matcher, examples, optional
  `planned`), `classifyPath`, `classifyPaths` (rule ids + max risk), `effectiveRisk` (raise-only),
  `runtimeReasons` (sorted, unique), `selectLanes` (static lane + runtime requirement). Rule table adapted to
  this tree: `.github/**` and `tools/**` high; exactly `package.json`/`package-lock.json`/`.nvmrc`/
  `wrangler.jsonc` high; `.env*`, `.dev.vars*`, `/security`, `AGENTS.md` high; auth/rbac/session segments,
  `db/migrations/**`, `src/platform/db/**`, account-deletion high; `src/platform/queue/**`, idempotency, jobs
  files high; `contracts/**` high; `scripts/**`, `test/**`, config files, `tools/parity/**` medium; `src/**`
  medium; `docs/**`, `_WIP/**`, `README.md`, `.gitignore` low; everything else `medium.unknown`.
  Reasons: `path.database-schema`, `path.runtime-platform`, `path.worker`, `path.critical-http`,
  `path.external-adapter`.
- `tools/cfkit/ci-classify.ts` — `ci classify --base <sha> --head <sha>`: validates revisions, reads the diff,
  parses declared risk from any `docs/exec-plans/{active,queued,completed}/*.md` in the diff, prints exactly
  `effective_risk=` and `runtime_required=` on stdout (reasons and the matching rule ids go to stderr).
  Exposed as `npm run ci:classify` for CI use.
- `tools/cfkit/task.ts` keeps plan parsing and consumes the classifier (task lanes: `fast` when low with no
  reasons, `full` otherwise, `ci` when runtime reasons exist).
- Parity manifest rows `risk.lane-classifier` and `risk.ci-classify` flip to `present` with the new evidence.

## Constraints

- Pure functions only in the classifier (no filesystem, no git) so the fixtures are exhaustive; the git read
  lives in `ci-classify.ts`.
- Raise-only semantics are load-bearing: a plan may declare a higher risk than its paths imply, never lower.
- Output stability matters: the two `key=value` lines are a machine interface for plan E17's workflow.
- Additive tooling: no runtime, contract or budget change.
- Every rule carries example paths; the fixture asserts each non-`planned` rule's examples exist in the tree.

## Acceptance Criteria

1. The classifier reproduces the family's semantics: first-match per path, max across paths, raise-only
   effective risk, `medium.unknown` default (fixtures).
2. Runtime reasons are derived from the reason table, sorted and unique; `selectLanes` yields the static lane
   plus a runtime requirement (fixtures).
3. Every risk rule's example paths resolve in the tree (fixture) — a rule that drifts into fiction fails.
4. `ci classify` prints exactly the two outputs for a real two-commit diff, classifies a docs-only change as
   low without runtime, and a change touching `src/features/auth/**` or `db/migrations/**` as high with
   runtime required (fixture with a temporary git repository).
5. Usage errors (`ci classify` without `--base`/`--head`, malformed revisions) exit `2` (fixture).
6. `task verify` lanes change only through the classifier: the task fixtures stay green and the task module no
   longer owns a private rule table.
7. `npm run verify` stays green; the manifest flips both rows to `present`.

## Steps

- [x] extract the classifier into `tools/cfkit/risk-classifier.ts` (rules, reasons, lanes) + rule-path fixture
- [x] `ci-classify.ts` + CLI wiring + `ci:classify` script + temp-repo fixture + usage-error fixture
- [x] task.ts consumes the classifier; task fixtures updated
- [x] manifest rows flipped, plan + roadmap bookkeeping, probe, verify

## Decision Log

- 2026-10-12: the rule table lives in one module consumed by both the task machine and CI. -> two tables would
  drift and silently mis-scope lanes; the family has exactly one.
- 2026-10-12: rules carry example paths and a fixture asserts they exist. -> the family's phantom
  `tools/harness-policy/` rule shows the failure mode; here it becomes a red fixture.
- 2026-10-12: stdout carries only the two `key=value` lines. -> CI writes stdout into `$GITHUB_OUTPUT`; human
  detail belongs on stderr.

## Verification

```bash
npm run typecheck:cfkit                 # clean after the extraction and the CLI wiring
npx eslint .                            # clean
node --test tools/cfkit/risk-classifier.test.ts tools/cfkit/ci-classify.test.ts tools/cfkit/cli-main.test.ts
                                        # 18 new fixtures: rules, reasons, lanes, diff classification, usage matrix
node --test tools/cfkit/task.test.ts    # 7 fixtures green on the shared classifier
npm run harness:parity                  # rows: present 15, declared-only 31 (both risk rows flipped)
# real run on this repository:
npm run ci:classify -- --base $(git rev-parse HEAD~1) --head $(git rev-parse HEAD)
#   -> effective_risk=high / runtime_required=false; stderr: 24 paths, rules high.contract|high.deploy|high.harness|low.docs, lane full
# probe: pointing high.auth's example at a nonexistent path turns the rule-path fixture red; revert restores green
npm run verify                          # fast profile green (with harness:parity as a step)
```

## Completion Notes

The repository now has one risk classifier (`tools/cfkit/risk-classifier.ts`) consumed by both the task
machine and CI:

- **Rules**: 15 rules with prefixes, exact names and suffixes (so `*.jobs.ts` is high.queue without a path
  enumeration), ordered first-match-per-path; `AGENTS.md` moved from low to medium.policy and a `planned`
  escape hatch exists for the `.dev.vars`/`.env` rule whose example paths never exist in a clean checkout.
  **Every non-planned rule carries example paths the fixture proves exist** — the family's phantom
  `tools/harness-policy/` rule is impossible here.
- **Reasons and lanes**: five runtime reasons (`path.database-schema`, `path.runtime-platform`, `path.worker`,
  `path.critical-http`, `path.external-adapter`) drive `selectLanes`, which returns the static lane plus a
  runtime requirement; the task machine's lane semantics are unchanged (`fast` low/no reasons, `full` otherwise,
  `ci` when runtime matters) and its fixtures pass untouched.
- **`cfkit ci classify --base <sha> --head <sha>`**: validates 40-64 hex revisions, reads
  `git diff --name-only --diff-filter=ACMRDT <base>...<head>`, raises the effective risk with any declared plan
  risk in the diff (tolerant parser shared with the task machine), and prints exactly the two
  `key=value` lines on stdout for `$GITHUB_OUTPUT`, with rules, reasons and lane on stderr. Exposed as
  `npm run ci:classify` for plan E17.
- Parity manifest: `risk.lane-classifier` and `risk.ci-classify` flipped to `present` (15 of 46 rows).

## Post-review fixes (2026-10-12)

Five findings, each reproduced with a live probe before fixing:

- **[High] a deleted or renamed plan in the range crashed `ci classify`.** `declaredRiskFromChangedPlans`
  read every diff path from the working tree, so a plan completed or removed inside the range (the common
  case — this very plan moved from `active/` to `completed/`) hit `ENOENT`. Plan risk is now read from the
  **blob at `head`** (`git show <head>:<path>`) and a path that does not exist there is skipped, which also
  removes the working-tree-versus-`head` ambiguity. Regression fixtures cover both the deleted plan and the
  `git mv` completion; the mutation probe (reading the working tree again) turns three fixtures red.
- **[Medium] a shadowed example hid behind a toothless fixture.** `medium.scripts`' example
  (`scripts/parity/harness.mjs`) actually classified as `high.harness`, and the fixture only checked
  existence. The example is now `scripts/auth/generate-keys.mjs`, and the fixture asserts **every** example
  exists _and_ classifies to its own rule — the same assertion that would have caught the shadowing.
- **[Medium] `.github/**` fell through to `medium.unknown`** even though the plan specified CI paths as high.
  A dedicated `high.ci` rule now matches `.github/` (example `.github/workflows/ci.yml`), so a workflow edit
  classifies high.
- **[Low] dead configuration**: `medium.config.prefixes: ["tools/cfkit/tsconfig"]` was unreachable behind
  `high.harness`'s `tools/cfkit/` prefix; removed (`tools/cfkit/tsconfig.json` is high.harness by design,
  verified live).
- **[Low] the existence fixture only required one example per rule.** It now requires all of them.

Also addressed from the review's residual risks: a failed diff (for example a shallow clone without the
merge-base) now throws an actionable error naming the `fetch-depth: 0` remediation instead of surfacing raw
git output, and the parity manifest's `ci.lanes` row records that requirement for plan E17.
