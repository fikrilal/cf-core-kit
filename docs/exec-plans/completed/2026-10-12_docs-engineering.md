# The engineering documentation set (harness parity F19)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.8 (rows 8.1-8.8, 8.10), §5.9 (row 5.9), §7 batch F; ADR-0013 (scope)

## Objective

Give the harness the documentation set the family has: one index, the CLI reference, the guardrails map, the
runtime-evidence contract, the duplication harness, the four workflow documents and per-feature notes — with the
indexes drift-checked rather than aspirational.

## Behaviour reference (backend-core-kit)

Row 8.1 (a CLI reference with commands, flags and exit codes), 8.2 (a rule-home map with the escalation ladder
"same failure twice ⇒ automate" and the suppression policy), 8.3 (runtime evidence per risk class plus the
redaction table), 8.5 (the duplication harness), 8.6 (loop engineering, agent loop, parallel-agent workflow, hill
climbing), 8.7 (per-feature engineering notes), 8.8 (the standards set with a family-status vocabulary), 8.10
(the CI lanes and baseline governance in the CI standard).

## Design

- `docs/engineering/README.md` is the index, with the status vocabulary (**written** / **planned** / **family**)
  and the ADR-0013 note that `admin/` and `merchantOnboarding/` notes are out of scope.
- `cfkit.md`: every command and flag — verification profiles and delegations, the task machine (begin, preflight,
  verify, status, workspace, cancel), handoff (dry-run and the three actions, with the refusal set named), the
  repository maintenance commands (events, maintenance, doctor, scaffold, remove) — plus the exit-code contract
  (0/1/2) and a "what it deliberately does not do" section.
- `guardrails.md`: a row per gate (eslint zones, budget, secrets, drift, contract, config, smells, duplication,
  plans, oracles, evidence, the task/workspace/handoff modules, `verify:gates`, the test-tier fixture, the CI
  workflow) with what it owns and how it fails; the four-step escalation ladder; and the suppression policy
  (reasons on every allowlist, `SMELLS_BASELINE_APPROVED` for baselines, no `--no-verify`).
- `runtime-evidence.md`: the required artifacts per risk class, a Workers transcript example (method/path/status/
  envelope/`X-Request-Id`, queue transitions, migration apply, limiter decision, R2 presign/head/delete), the
  redaction table the diagnostics writer actually implements, and the "what never appears" rule that makes the
  episode schema's forbidden keys legible.
- `duplication-harness.md`: both profiles, their scopes, thresholds, fatality and allowlists; the category list;
  why the small-helper profile is scoped to `src/**` (44 boilerplate clones otherwise); the allowlist shape and
  the pruning rule.
- The four workflow documents: `loop-engineering.md` (pacing, early verification, stop conditions, recording),
  `agent-loop.md` (the phase diagram with per-phase costs and the "never" list), `parallel-agent-workflow.md`
  (when to prepare a workspace, what stays shared, cancel versus cleanup), `hill-climbing.md` (the escalation
  ladder applied to harness work, with recalibration and recorded non-ports).
- Eight feature notes (`auth/{oidc-google,session-management,token-refresh-and-request-retry,email-verification}`,
  `users/{profile-images,account-deletion}`, `email/resend`, `push/port-and-fcm-deferral`): what each does, where
  it lives, the rules the code keeps, its evidence, and its deferrals.
- `docs/standards/README.md` gains the family-owned topics as **family**-status references with the local
  enforcement for each (contract suite, error codes, config:check, list-query, idempotency/budget,
  secrets/limiter/crypto allowlist) and the rule that a topic becomes normative only when we own a rule the
  family does not state. `docs/standards/ci-cd.md` gains the baseline-governance section.
- `docs/README.md` navigates the engineering set.

## Constraints

- Documentation states what is true: every command, flag, threshold and gate named in these files exists in the
  repository, and the drift check resolves every link (the set is inside the link graph `drift:check` walks).
- A gap is written down, not implied: the index's status vocabulary and the plan's deferrals list carry what is
  not here.
- The runtime-evidence redaction table is the one `episodes.ts` implements — the document and the code agree by
  construction, and the fixtures pin the patterns.

## Acceptance Criteria

1. The engineering set exists with the index and thirteen documents, and the index names each one with its status
   (fixture: the file list and the index agree).
2. `drift:check` resolves every link in the new documents (the existing link-graph gate).
3. The guardrails map names every gate that exists, and every gate it names exists in the repository (fixture).
4. `cfkit.md` names every command in `USAGE` and no command that does not exist (fixture).
5. The standards index carries the family topics with a local enforcement row each, and the CI standard carries
   the baseline-governance rule.
6. `npm run verify`, `npm run verify:gates` and `npm run verify:ci` are green, and `docs.engineering-set` plus
   `docs.standards-additions` flip to `present` (44 of 46).

## Steps

- [x] the index, `cfkit.md`, `guardrails.md`, `runtime-evidence.md`, `duplication-harness.md`
- [x] the four workflow documents
- [x] eight feature notes across four directories
- [x] the standards index (family topics + local enforcement), the CI standard's baseline governance, the
      `docs/README.md` navigation
- [x] a fixture tying the indexes to what exists, manifest flips, bookkeeping

## Decision Log

- 2026-10-12: the index carries a status vocabulary and a Planned section. -> a documentation set that hides its
  own gaps is worse than one that lists them; the one planned item (reconciling the repository's `review-change`
  skill with the family's dimension list and its "checks not run" honesty section, row 8.9) is named there.
- 2026-10-12: `guardrails.md` is a map, not a rulebook. -> every rule has exactly one home; duplicating the rules
  in prose would create a second source of truth that drifts. The CI-lane table lives in the CI standard (E17),
  and this document points at it.
- 2026-10-12: the runtime-evidence redaction table mirrors `episodes.ts`. -> the document is checkable against the
  code, and the fixture that pins each redaction pattern is the same one that pins the writer.
- 2026-10-12: family topics stay `family`, never restated. -> we follow the contract (ADR-0009) and do not own
  those rules; the index records where each is locally enforced instead, which is the part we can be wrong about.
- 2026-10-12: `admin/` and `merchantOnboarding/` notes are out of scope, not missing. -> ADR-0013 decided that
  surface is not built; the family keeps notes for both, and the index says so.
- 2026-10-12: the per-feature notes are short and factual. -> each answers what it does, where it lives, what the
  code keeps, its evidence and its deferrals; longer prose would duplicate the exec plans.

## Verification

```bash
node --test tools/cfkit/docs.test.ts   # 3 fixtures: the set matches the index and the index matches the set,
                                       # every USAGE command is documented and nothing else is, every guardrail
                                       # row names an existing gate file
node scripts/drift/check.mjs           # markdown links across docs/ resolve (the new set is in the graph)
npm run verify                         # fast profile green
npm run verify:gates                   # 8/8 gates bite
npm run verify:ci                      # ci profile green
```

## Completion Notes

The engineering set landed as thirteen documents plus the index: the CLI reference, the guardrails map with the
escalation ladder, the runtime-evidence contract whose redaction table is the one the diagnostics writer
implements, the duplication harness, the four workflow documents and eight feature notes. The standards index now
carries the family-owned topics with the local enforcement for each, and the CI standard names the baseline
governance rule. One item is explicitly planned rather than silently missing (the review-skill alignment), and the
out-of-scope feature notes are attributed to ADR-0013.
