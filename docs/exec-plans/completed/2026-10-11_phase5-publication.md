# Phase 5 publication: the harness, the gates, and the docs

- Status: completed
- Owner: fikrilal
- Risk: high
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0009 (cfkit and the verify gate), ADR-0010 (deployment), ADR-0011 (gate honesty); roadmap Phases 5-6 follow-ups

## Objective

Publish the completed Phase 5 harness (scaffold/remove, verify profiles, task lifecycle,
handoff), the Phase 6 cross-cutting gates (CI hardening, secrets scan, coverage floors,
duplication policy), the standards completion, and the documentation currency passes — in
approved, reviewable scopes, through the kit's own handoff flow (task → verify → per-scope
approvals → commit).

## Scopes

Scopes, in landing order 1 → 2 → 3 (order is load-bearing: the profiles in scope 2 reference
the scripts and dev dependencies scope 1 adds, and `package.json`/`package-lock.json` can never
be split; scope 3 is independent):

1. **Gates** (14 files) — `scripts/security/**`, `scripts/ci/**`, `scripts/duplication/**`,
   `scripts/scaffold/**`, `tools/duplication-allowlist.json`, `vitest.config.ts` (coverage
   floors), `eslint.config.mjs` (the `URL` mjs global), `src/platform/http/openapi.ts`
   (duplication refactor), `tools/parity/coverage.json` (canonicalized order),
   `.github/workflows/ci.yml`, `package.json` + `package-lock.json` (gate scripts and the
   `jscpd` / `@vitest/coverage-v8` dev dependencies).
2. **Tooling** (25 files) — `tools/cfkit/**` (scaffold/remove modules, task lifecycle, handoff
   with path-scoped approvals, the five verify profiles, the runtime smoke), `.gitignore`
   (`.cfkit/`), `package.json` (`verify:ci` → the ci profile, `test:scripts` entries).
3. **Docs** (38 files) — six standards + index, four guides, both review skills, AGENTS.md,
   README.md, `docs/**` (maps, template, plans, roadmap), `contracts/README.md`.

## Constraints

- Publication is per-scope through `handoff dry-run --paths <scope>` → approval → `handoff
commit --paths <scope> --challenge <c>`; no scope commits files outside its list; the
  approvals are one-time and expire in 15 minutes, so each dry-run runs immediately before its
  commit rather than in advance.
- No push in this task: publishing means local commits; remote publication stays a separate
  explicit decision.

## Acceptance Criteria

1. `task verify` passes on the lane the classifier chooses for the working tree.
2. Each scope's approval lists exactly its paths (validated against the changed set) and its
   commit stages exactly those paths.
3. The tree is clean afterwards and `git log` shows the scoped commits.

## Steps

- [x] task begin + verify — high risk, ci lane, verified twice (attempt 2/3 after the scope-error fix)
- [x] Per-scope dry-runs on approval; commits under each challenge — three scoped approvals, three commits: gates `4d7b016`, tooling `94b7320`, docs `675e8ac`
- [x] Post-publication verification and plan completion

## Decision Log

- 2026-10-11: scoped approvals via `--paths` (new). -> the user's standing requirement is scoped commits; the handoff as built bound to every changed path
- 2026-10-11: no push. -> publication here is local history; remote effects need their own approval
- 2026-10-11: the scoped dry-run probe found an uncaught scope error (CLI crash instead of a refusal); the dry-run path now shares the mutation path's refusal handling, pinned by the probe and the scope tests

## Verification

Structural section added 2026-10-13, when `plans:check` began requiring it (the plan contract in
`docs/exec-plans/README.md`). The evidence below is quoted from this plan's own Publication Record; nothing
new is claimed.

```bash
cfkit task verify --task 2026-10-11_phase5-publication   # ci lane; verified three times (twice after edits,
                                                         # once on the frozen content) before approval
cfkit handoff dry-run --task 2026-10-11_phase5-publication --action commit --paths <scope>
cfkit handoff commit --task 2026-10-11_phase5-publication --challenge <c>
```

- Classifier result on the final diff: `high` risk, `ci` lane, 77 changed files.
- Commits landed per scope: `4d7b016` (gates, 14 files), `94b7320` (tooling, 26 files), `675e8ac`
  (docs, 38 files).

## Publication Record

Executed under the user's explicit instruction ("ok I think we can commit and split based on scope
if needed"), through the handoff flow per scope: fresh scoped dry-run → challenge → commit with
exactly the approved paths.

| Commit    | Scope   | Files | Subject                                                                 |
| --------- | ------- | ----- | ----------------------------------------------------------------------- |
| `4d7b016` | gates   | 14    | feat: add the CI, secrets, coverage, and duplication gates              |
| `94b7320` | tooling | 26    | feat: add the cfkit harness — scaffold/remove, profiles, tasks, handoff |
| `675e8ac` | docs    | 38    | docs: land the standards, guides, and current harness documentation     |

Dogfooding findings worth keeping:

1. **The exact-path staging exposed the manifest coupling immediately.** Committing the final
   `package.json` in the gates scope would have pointed `verify:ci` at the `ci` profile a scope
   before it exists. The commit was amended (local, unpushed) with an intermediate manifest —
   gate scripts and dependencies only, `verify:ci` still on `full` — and statically checked
   against the commit's own file list. **Limitation recorded:** the handoff binds paths, and its
   fingerprint guards content between dry-run and mutation, not after the commit; a post-approval
   amend of an approved path is therefore possible. Acceptable for a solo local flow, worth a
   guard if the tool ever drives shared remotes.
2. **The scoped dry-run probe caught an uncaught failure.** Passing a `--paths` entry that was
   not changed crashed the CLI instead of refusing; the dry-run path now shares the mutation
   path's refusal handling, pinned by the probe and the scope tests.
3. **The classifier did its job on a real diff**: 77 changed files across harness, contract, and
   docs classified `high`, lane `ci`, and the task verified three times (twice after edits,
   once on the frozen content) before any approval was issued.
