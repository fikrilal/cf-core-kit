# `cfkit` — the harness CLI

Every command the repository's own tooling exposes, what it does, and what it delegates to. Exit codes are a
contract: **0** success, **1** refusal or failure, **2** usage error (a missing or unknown flag/argument). A
refusal never leaves the tree half-changed.

## Verification

| Command                                                                                                               | Behaviour                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify [--profile fast\|full\|gates\|runtime\|smoke\|ci]`                                                            | Runs the profile; stops at the first failing step and prints its taxonomy code, remediation and repairability. Default `fast`.                          |
| `budget:check`, `contract:check`, `contract:lint`, `harness:parity`, `oracles check`, `plans check`, `evidence check` | Thin delegations to the corresponding script or validator; `--help` lists them, and each has its own failure marker asserted by the gate-honesty suite. |
| `ci classify --base <sha> --head <sha>`                                                                               | Prints exactly `effective_risk=` and `runtime_required=` on stdout for `$GITHUB_OUTPUT`; the detail goes to stderr.                                     |

## Tasks

| Command                                                       | Behaviour                                                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `task begin --plan <path>`                                    | Binds a task to an active plan: authority hash, scope, maximum risk, budgets, repository identity and base revision.                                                           |
| `task preflight --task <id> [--action verify]`                | Re-checks the five bindings before any work: the plan and its task id, the `Authority` hash, the action, the task-scoped paths, and the effective risk against `Maximum risk`. |
| `task verify --task <id>`                                     | Preflight, then the lane profile under the plan's timeout; records an episode and a diagnostic per attempt; lands in `ready_for_review`, `repairing` or `escalated`.           |
| `task status --task <id>`                                     | Prints the phase, stop reason, lane, budgets, failure fingerprints and the last transitions.                                                                                   |
| `task workspace prepare\|status\|cancel\|cleanup --task <id>` | The opt-in linked worktree at `.cfkit/worktrees/<id>` on `cfkit/<id>`, its mode-0600 manifest, the claim release and the cleanup.                                              |
| `task cancel --task <id>`                                     | Terminal cancellation.                                                                                                                                                         |

## Handoff

| Command                                                                     | Behaviour                                                                                                                                                                                                                |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `handoff dry-run --task <id> --action commit\|push\|draft-pr [--paths a,b]` | Issues a 15-minute approval bound to the task fingerprint, the exact paths, the branch and the workspace; only the challenge hash is stored.                                                                             |
| `handoff commit\|push\|draft-pr --task <id> --challenge <c>`                | Verifies every binding, then performs exactly one action: stage the approved paths and commit, push without force, or open a **draft** pull request. Merge, deploy, force-push and ready-for-review are not implemented. |

## Repository maintenance

| Command                                                                               | Behaviour                                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `events run --once [--dry-run]`                                                       | Promotes one queued plan into `active/` when the guards allow it; writes claimed/promoted receipts under `.cfkit/events/`; the same queued revision can never be promoted twice.    |
| `maintenance run --once`                                                              | `plans:check`, `smells:check`, `duplication:report`, `audit:prod` in order, under the repository lock, with one receipt per run.                                                    |
| `doctor`                                                                              | The readiness report: twelve checks, hard failures versus warnings.                                                                                                                 |
| `scaffold feature <name> [--tier simple\|clean] [--with-queue] [--dry-run] [--force]` | Plans and applies a feature slice; dry runs write nothing.                                                                                                                          |
| `scaffold endpoint <operationId>`                                                     | Plans and applies a pinned pending operation, its spec, the `src/app.ts` wiring and the parity manifest move.                                                                       |
| `remove endpoint <operationId>`                                                       | Reverses an endpoint scaffold (marker-checked).                                                                                                                                     |
| `remove feature <name> --yes [--force-core]`                                          | Reverses a feature scaffold, prunes the smell baseline and both duplication allowlists for the removed paths, and drops the `src/jobs.ts` lines a `--with-queue` scaffold inserted. |

## What it deliberately does not do

No commit, push, merge, deploy or database migration runs without an explicit command and, for anything that
touches history or a remote, an unexpired approval. The harness edits a working tree and runs read-only gates;
everything else is a human decision recorded in a plan.
