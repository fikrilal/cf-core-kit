# ADR: Verified handoff

- Status: Accepted
- Date: 2026-10-15
- Decision makers: Core kit maintainers

## Context

The handoff already used expiring challenges and `--paths` scoping, but an approval was not bound to the
workspace or the branch, and the action set was not asserted to exclude anything.

## Decision

An approval lives for 15 minutes, stores only the challenge hash (mode 0600), and is bound to the task
fingerprint, the exact paths, the branch and — when the task has one — the workspace it was issued in. The
mismatch is refused in both directions (an approval issued without a workspace cannot be spent once the task has
one). The action set is fixed: stage exactly the approved paths and commit, push without force, or open a
**draft** pull request. Merge, deploy, force-push, skip-hooks and ready-for-review are not implemented, and a
fixture asserts both the adapter's argument list and the absence of those literals in the command sources. CI
mirrors this with lanes and a single `required` status.

## Rationale

A binding that only binds the easy direction is not a binding, and a refusal set written in prose is a promise.
Running the handoff inside the workspace is what makes `cfkit/<taskId>` real.

## Consequences

A refused handoff leaves the approval spendable because the check runs before any git mutation. A successful
handoff moves the task to the terminal `handed_off` phase. The 15-minute lifetime is fixture-tested with injected
time rather than by waiting.

## Alternatives Considered

- Long-lived approvals: convenient, and impossible to reason about.
- A generic `gh` wrapper: would expose actions this repository does not want.

## Links / References

- Related ADRs: 0016 (risk-aware verification), 0017 (workspaces)
- Related docs: `docs/engineering/cfkit.md`, `docs/standards/ci-cd.md`
- Related proposals: `_WIP/2026-10-12_harness-parity-proposal.md`
