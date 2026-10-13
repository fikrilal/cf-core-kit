# Task workspaces (harness parity D15)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.6 (row 6.4), §7 batch D

## Objective

Give a task its own working tree when it needs one. Worktrees are opt-in — the single-tree flow stays valid —
but two tasks can no longer share a working tree by accident, and every workspace is bound to the state it was
prepared for.

## Behaviour reference (backend-core-kit)

Row 6.4: `task workspace prepare|status|cancel|cleanup` with a linked worktree at `.cfkit/worktrees/<taskId>`
on branch `cfkit/<taskId>`, a repository lock with stale recovery, and a mode-0600 `workspace.json` validated
against the task state (task id, plan path, authority hash, base revision).

## Design

- `tools/cfkit/workspace.ts`: the manifest (`schemaVersion`, task id, plan path, authority hash, base revision,
  branch, path, `state: prepared|released`), validation against the state, `prepareWorkspace` (inside the
  repository lock from C13: `git worktree add -b cfkit/<taskId> .cfkit/worktrees/<taskId> <baseRevision>`),
  `cleanupWorkspace` (`worktree remove --force`, `branch -D`, `worktree prune`, then mark released), and
  `preparedWorkspaces` (which task ids currently hold one). Git goes through an injectable `GitRunner`, so the
  fixtures never touch the real repository and the live probe does.
- `tools/cfkit/commands-workspace.ts`: the four subcommands. `status` prints the manifest and any stale binding;
  `cancel` releases the claim **without** deleting the worktree, because salvage is a human decision; `cleanup`
  removes both. Wired as `cfkit task workspace …`.
- Refusals are explicit: the target path exists, the branch exists, the task already has a prepared workspace, or
  another task holds one (only one workspace per repository at a time).

## Constraints

- Single-tree remains the default: a task with no workspace behaves exactly as before, and nothing in the
  machine requires one.
- The manifest is mode 0600 and lives beside the state under `.cfkit/tasks/<id>/`; the worktree itself sits under
  the gitignored `.cfkit/worktrees/`.
- Every git mutation happens under the repository lock, and `prepare`/`cleanup` report git failures instead of
  pretending they succeeded (a failed cleanup leaves the manifest `prepared`).
- The workspace is bound, not trusted: `validateWorkspace` compares task id, plan path, authority hash, base
  revision and branch, so a workspace prepared before an authority change is reported as stale.

## Acceptance Criteria

1. `prepare` creates the worktree, the branch and a mode-0600 manifest, and calls git with the exact arguments
   (fixtures).
2. `prepare` refuses an existing path, an existing branch, its own prepared workspace, and another task's claim
   (fixtures); a live lock refuses it too, and the lock is released afterwards (fixtures).
3. `cleanup` removes worktree and branch in order and marks the manifest released; git failures are reported and
   the manifest stays prepared (fixtures).
4. `validateWorkspace` refuses each stale binding (fixtures).
5. The command surface: `status` on a workspace-less task says so, `cancel` without a workspace refuses, `cancel`
   leaves the worktree, an unknown subcommand is a usage error (fixtures).
6. Live probe: a real worktree and branch are created at the base revision, a second task is refused, `cancel`
   releases the claim, `cleanup` removes the worktree and branch and marks the manifest released.
7. `npm run verify`, `npm run verify:gates` and `npm run verify:ci` are green, and `task.workspace-lock` flips to
   `present` (35 of 46).

## Steps

- [x] `workspace.ts` (manifest, validation, prepare, cleanup, prepared list)
- [x] `commands-workspace.ts` + `task workspace` dispatch + USAGE
- [x] 7 fixtures + `test:scripts` registration
- [x] live probe (prepare, refuse a second task, cancel, cleanup) + docs + manifest flip + bookkeeping

## Decision Log

- 2026-10-12: worktrees are opt-in, not mandatory. -> the proposal's own note says the single-tree flow stays
  allowed and workspaces are required only when two tasks run concurrently; making them mandatory would slow
  every task for a case most do not have.
- 2026-10-12: `cancel` releases the claim and leaves the worktree. -> the worktree may hold uncommitted work;
  deleting it is the one action that cannot be undone, so it belongs to `cleanup`, which says so.
- 2026-10-12: one workspace per repository at a time. -> two prepared worktrees would let two tasks commit to the
  same branch namespace and the same ledger; the claim is cheap to release and expensive to get wrong.
- 2026-10-12: the fixture caught a missing guard — re-preparing a task that already had a prepared workspace
  succeeded when the worktree directory was absent. -> a prepared manifest now refuses re-preparation outright,
  because re-creating a worktree could orphan one that still exists.
- 2026-10-12: the lock is taken for the git mutation, not for the workspace's lifetime. -> a workspace outlives
  any lock; what must be serialized is `worktree add`/`remove`, and the manifest is what records the claim.
- 2026-10-12: binding approvals to a workspace is left to D16. -> this plan gives the binding a place to live;
  what a handoff does with it is row 6.5.

## Verification

```bash
node --test tools/cfkit/workspace.test.ts   # 7 fixtures: prepare arguments and manifest, every refusal,
                                            # lock interplay, cleanup ordering and failure reporting,
                                            # stale-binding validation, command surface, manifest round-trip
# live probes (recorded):
#   task workspace prepare --task probe-workspace
#     -> "workspace prepared at .cfkit/worktrees/probe-workspace on cfkit/probe-workspace"
#     -> git worktree list shows the linked worktree at d4c7f0e; branch cfkit/probe-workspace exists
#     -> workspace.json mode 0600; `status` reports prepared/present/true
#   task workspace prepare --task probe-second
#     -> refused: "another task already holds a workspace: probe-workspace"
#   task workspace cancel --task probe-workspace
#     -> claim released, worktree left in place for salvage
#   task workspace cleanup --task probe-workspace
#     -> exit 0; git worktree list back to one entry; no cfkit/* branch; .cfkit/worktrees/ empty;
#        manifest state "released"
#   cleanup -> probes cancelled and removed, plans:check green
npm run verify                              # fast profile green
npm run verify:gates                        # 8/8 gates bite
npm run verify:ci                           # ci profile green
```

## Completion Notes

D15 landed the workspace as an opt-in capability with a binding that refuses staleness: a linked worktree on
`cfkit/<taskId>` at the task's base revision, a mode-0600 manifest beside the state, one workspace per
repository, and a `cancel`/`cleanup` split that keeps destructive actions explicit. The live probe exercised the
whole lifecycle against the real repository — prepare, refusal for a second task, cancel, cleanup, and a clean
`git worktree list` afterwards. The fixture caught one missing guard (re-preparing a task that already held a
workspace), and binding a handoff approval to a workspace is deliberately left to D16, which owns row 6.5.
