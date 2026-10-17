# ADR: Isolated task workspaces

- Status: Accepted
- Date: 2026-10-15
- Decision makers: Core kit maintainers

## Context

Two tasks in one working tree share a checkout, a branch namespace and the same state directory. The harness
serialised mutations with a repository lock, but it could not run two tasks side by side at all.

## Decision

Workspaces are **opt-in**: `cfkit task workspace prepare` creates a linked worktree at
`.cfkit/worktrees/<taskId>` on branch `cfkit/<taskId>` at the task's base revision, and records a mode-0600
`workspace.json` binding the task id, plan path, authority hash and base revision. One workspace per repository
at a time, guarded by the repository lock. `cancel` releases the claim and leaves the worktree for salvage;
`cleanup` removes the worktree and the branch. The handoff runs git inside the bound workspace.

## Rationale

Most work is sequential, so mandatory worktrees would tax the common case; the single-tree flow stays valid.
The binding is what makes the isolation real: an approval bound to a worktree that then committed on `main`
would be a binding in name only.

## Consequences

A task without a workspace behaves exactly as before. The workspace manifest validates against the state, so a
stale binding is reported instead of used. Release and removal are separate because deleting uncommitted work is
the one irreversible action.

## Alternatives Considered

- Mandatory worktrees: safer for parallel work, slower for everything else.
- One shared tree with discipline: the lock serialises writes but not the mental model.

## Links / References

- Related ADRs: 0015 (task authority), 0019 (verified handoff)
- Related docs: `docs/engineering/parallel-agent-workflow.md`, `docs/exec-plans/README.md`
- Related proposals: `_WIP/2026-10-12_harness-parity-proposal.md`
