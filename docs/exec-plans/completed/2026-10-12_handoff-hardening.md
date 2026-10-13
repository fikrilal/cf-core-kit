# Handoff hardening (harness parity D16)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.6 (row 6.5), §7 batch D

## Objective

Close batch D by making a handoff approval something that cannot be reused, borrowed or spent in the wrong
place: bound to the task fingerprint, the exact paths, the branch **and** the workspace, hash-only on disk,
short-lived, and limited to three actions.

## Behaviour reference (backend-core-kit)

Row 6.5: approvals expiring after 15 minutes, bound to fingerprint/workspace/branch/exact paths, storing only
the approval hash; commit = exact paths, push = non-force, draft PR only, and no merge, deploy, force-push or
ready-for-review.

## Design

- `tools/cfkit/handoff.ts` gains the two bindings that were missing: `branch` (always) and `workspacePath`
  (when the task has a prepared workspace). `verifyApproval` refuses a checkout on another branch, and refuses
  a workspace mismatch **in both directions** — an approval issued in a workspace cannot be spent without it,
  and one issued without a workspace cannot be spent once the task has one. The stored document keeps only
  `challengeHash`; the challenge never reaches disk.
- The refusal set is **data**: `GH_DRAFT_PR_ARGS`, `FORBIDDEN_GIT_FLAGS` and `FORBIDDEN_GH_FLAGS` are exported,
  the draft-PR adapter builds its arguments from them, and a fixture asserts both the lists and that
  `commands-handoff.ts`/`handoff-actions.ts` never contain a forbidden flag as a literal.
- `handoffContext(root, taskId)` decides _where_ a handoff happens: the task's prepared workspace when it has
  one (so the commit lands on `cfkit/<taskId>`), otherwise the repository root. Dry-run scopes the paths from
  that context and binds the approval to it; the mutation runs git there.
- `tools/cfkit/handoff-actions.ts` holds the three mutations (exact-path staging + commit, non-force push,
  draft PR via `gh`) so `commands-handoff.ts` stays a CLI surface — the file-length rule fired again and the
  split is the answer, not a disable comment.

## Constraints

- An approval is single-use in effect: a mutation marks it `uncertain` when the action fails, and a successful
  handoff moves the task to `handed_off`, which is terminal.
- Nothing in the adapter can merge, deploy, force-push, skip hooks or mark a PR ready; that is asserted, not
  promised.
- The binding is checked _before_ any git mutation, so a refused handoff leaves the repository untouched and the
  approval still spendable.
- Verification, not invention: the live probe and the fixtures use the real commands; the 15-minute lifetime is
  fixture-covered with injected time rather than by waiting.

## Acceptance Criteria

1. A new binding is refused for a different branch, a different workspace, and a workspace/no-workspace
   mismatch (fixtures).
2. A fresh, matching approval is accepted with the new bindings present (fixtures).
3. The written approval contains `challengeHash`, the branch, and never the challenge (fixture).
4. The refusal set is exported data, the adapter builds from it, and no forbidden flag appears in the command
   sources (fixture).
5. Live probe: a workspace-bound dry-run prints branch `cfkit/probe-handoff` and the workspace; a tampered
   `workspacePath` refuses with `approval is bound to workspace …`; the restored approval commits **inside the
   worktree**, leaving `main` untouched and the task in `handed_off`.
6. `npm run verify`, `npm run verify:gates` and `npm run verify:ci` are green, and `handoff.workspace-binding`
   flips to `present` (36 of 46).

## Steps

- [x] `handoff.ts`: branch + workspace bindings, the verdict reasons, the exported refusal set
- [x] `commands-handoff.ts` + `handoff-actions.ts`: the handoff context, workspace-bound git, the adapter args
- [x] fixtures: the new bindings, hash-only storage, the refusal set as data (10 total in the file)
- [x] live probe (tamper → refuse → restore → commit in the worktree) + docs + manifest flip + bookkeeping

## Decision Log

- 2026-10-12: the workspace binding is symmetric. -> an approval issued without a workspace must not be spendable
  once the task has one, or the binding would only bind the easy direction.
- 2026-10-12: the handoff runs _in_ the workspace. -> an approval bound to a worktree that then committed on
  `main` would be a binding in name only; running git there is what makes `cfkit/<taskId>` real, and the probe
  shows `main` staying put.
- 2026-10-12: the refusal set is exported data rather than prose in a comment. -> the fixture can then assert
  the adapter's argument list _and_ the absence of forbidden flags in the source, which is the difference
  between a policy and a promise.
- 2026-10-12: the action helpers moved to their own module. -> `commands-handoff.ts` passed the 350-line rule
  while gaining the context work; splitting on the seam (CLI surface vs git mutations) keeps both readable
  instead of relaxing the rule.
- 2026-10-12: expiry stays fixture-tested with injected time. -> waiting fifteen minutes to prove a timeout is
  not verification, it is theatre.

## Verification

```bash
node --test tools/cfkit/handoff.test.ts   # 10 fixtures: freshness, every mismatch reason, branch and workspace
                                          # bindings, hash-only storage, the refusal set as data, persistence
                                          # permissions, the task fingerprint, unavailable actions, --paths
# live probes (recorded):
#   task workspace prepare --task probe-handoff -> worktree on cfkit/probe-handoff
#   handoff dry-run --task probe-handoff --action commit --paths tools/cfkit/probe-note.txt
#     -> "1 of 1 changed paths; branch cfkit/probe-handoff; workspace .cfkit/worktrees/probe-handoff"
#   (approval workspacePath tampered)
#     -> refused: "approval is bound to workspace .cfkit/worktrees/somewhere-else" (exit 1)
#   (restored) handoff commit --message "probe: workspace-bound handoff" --challenge <c>
#     -> applied; the commit db13b55 landed in the worktree on cfkit/probe-handoff and main stayed at beaad42;
#        the task moved to handed_off
#   task workspace cleanup -> worktree and branch gone; probes removed; plans:check green
npm run verify                             # fast profile green
npm run verify:gates                       # 8/8 gates bite
npm run verify:ci                          # ci profile green
```

## Completion Notes

Batch D closes with the handoff bound to what it is actually approving: the fingerprint, the exact paths, the
branch and the workspace. The probe showed the whole chain — a workspace-bound dry-run, a tampered binding
refused before any git ran, then a commit landing on `cfkit/probe-handoff` with `main` untouched and the task
terminal in `handed_off`. Two structural fixes came out of the work: the refusal set became data a fixture can
check, and the action helpers moved to their own module when the file-length rule fired (again the rule doing
its job rather than being relaxed).
