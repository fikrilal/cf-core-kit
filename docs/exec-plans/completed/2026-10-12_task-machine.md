# Task machine and preflight (harness parity D14)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.6 (rows 6.1, 6.2, 6.3, 6.6), §7 batch D; ADR-0011

## Objective

Open batch D by turning the three-state task tracker into the machine the rest of the harness reads: eleven
phases with append-only transitions, a preflight that re-checks what the plan authorised, failure fingerprints
against the plan's repair limit, a plan-driven timeout, and a repository identity binding.

## Behaviour reference (backend-core-kit)

Rows 6.1-6.3 and 6.6: the eleven states with append-only history in `state.json` (schema 2), `task preflight`
(authority hash, action, scope, risk, fingerprint), failure fingerprints `sha256(fingerprint:code)` with the
plan's repair limit and timeout, and `git-repository.ts` facts (identity hash, base revision, preexisting
changes).

## Design

- `tools/cfkit/task-state.ts` owns the state: constants and phases, the `TaskState` shape, the plan-derivation
  helpers (`Authority`, `Maximum risk`, `Allowed paths/actions`, `Repair limit`, `Task timeout`), the hashes
  (`authorityHash`, `failureFingerprint`), persistence (mode-0600 writes) and the **schema 1 → 2 migration**,
  which maps the old status onto a phase and says so in the history.
- `tools/cfkit/task.ts` owns the machine: the transition table (a phase absent from it is terminal),
  `transition` (refuses illegal hops rather than writing them), `recordFailure` (counts repeats per
  `sha256(stepId:code)` fingerprint, escalates with stop reason `task.repair-limit`), `recordSuccess`, and
  `beginTask` (binds authority hash, scope, maximum risk, budgets, repository identity and base revision).
- `tools/cfkit/preflight.ts`: five bindings — the plan exists and still declares this task; its `Authority`
  hashes to the recorded value; the action is in `Allowed actions`; the paths the **task** touched are inside
  `Allowed paths`; the effective risk has not climbed past `Maximum risk`. Pre-existing changes are excluded
  from the scope (they are not the task's doing) and controller artifacts (`_WIP/*.md` reports, `.cfkit/**`,
  plan moves) are exempt. Repository identity mismatch refuses; a moved revision is only a note.
- `tools/cfkit/git.ts` gains `repositoryIdentity` (sha256 of the real worktree path and the common git
  directory), `currentRevision` was already there.
- `cfkit task verify` now: refuses a terminal task, runs preflight (a refusal is recorded as a failure with code
  `task.preflight`), hops `preparing`/`running` (or resumes from `repairing`), runs the lane under a
  **plan-driven deadline** checked before each step, and lands in `ready_for_review` or — on a failed attempt —
  in `repairing`, escalating with `task.timeout`/`task.repair-limit` when a budget runs out. Episodes and
  diagnostics (C11) are still written per attempt.
- `cfkit task preflight --task <id> [--action verify]` and `cfkit task cancel --task <id>` join the CLI, and a
  successful handoff now records the `handed_off` phase (D16 tightens what a handoff is bound to).

## Constraints

- Transitions are append-only and validated: the state file never contains an illegal hop, because the machine
  refuses to write one.
- Budgets come from the plan (C10 requires them for active plans); the repair limit counts **per fingerprint**,
  so two different failures on one step do not exhaust one budget.
- `Task timeout` is a _between-steps_ deadline: the runner is sequential, so the check happens before each step
  and once after the last one. A step that hangs is still bounded by the process runner's own 15-minute kill.
- Schema 1 states are migrated in memory on read (the history entry says so); nothing is silently reinterpreted.

## Acceptance Criteria

1. `beginTask` records phase, authority + hash, scope, maximum risk, budgets, identity and base revision, and a
   schema 2 state round-trips (fixtures).
2. Every phase is reachable only through its legal transitions; the table and the phase list agree; terminal
   phases refuse everything (fixtures).
3. Repair counting is per fingerprint, and the plan's limit escalates with stop reason `task.repair-limit`
   (fixtures).
4. Timeouts parse (`30m`, `2h`, `45s`, fallback 90m) and a schema 1 state migrates with its history recorded
   (fixtures).
5. Preflight refuses each broken binding (missing plan, changed task id, changed authority, unauthorised action,
   out-of-scope path, risk above the maximum, foreign repository) and exempts pre-existing paths and controller
   artifacts (fixtures).
6. The wired lifecycle is proven live: begin → preflight (clean, then refused after the plan's `Authority`
   changed, then clean again) → verify with a planted lint failure landing in `repairing` with a fingerprint →
   verify again resuming from `repairing` → `ready_for_review`, all through `cfkit task`.
7. `npm run verify`, `npm run verify:gates` and `npm run verify:ci` are green, and `task.state-machine` plus
   `task.preflight` flip to `present` (34 of 46).

## Steps

- [x] `task-state.ts` (state, plan derivation, hashes, persistence, migration) + `task.ts` (machine)
- [x] `preflight.ts` + `git.ts` repository identity
- [x] `commands-task.ts` (begin/preflight/verify/status/cancel) + `commands-handoff.ts` (phase check, handed_off)
- [x] fixtures: 11 machine/state tests + 8 preflight tests, `test:scripts` registration
- [x] live probes, docs (exec-plans README), manifest flips, bookkeeping

## Decision Log

- 2026-10-12: the state layer and the machine are two modules. -> `task.ts` grew past the file-length rule while
  mixing persistence, migration and policy; the split gives each one owner, and the plan contract's 350-line
  rule is what surfaced it.
- 2026-10-12: the scope check compares only the **task's own** paths (current minus the paths that were already
  dirty when it began). -> a busy working tree must not fail its task, and the pre-existing changes are recorded
  in the state so the comparison is exact rather than heuristic.
- 2026-10-12: a failed attempt lands in `repairing`, and the next verify resumes from there. -> the live probe
  caught `authorized -> running` being attempted (the table requires the `preparing` hop) and then a failed run
  leaving the task in `verifying`; both are now structural: the hop is derived from the phase, and the failure
  transition is part of the machine's own table.
- 2026-10-12: a preflight refusal is recorded as a failure with code `task.preflight`, not just printed. -> it
  counts against the repair ledger like any other repeat, and the run that keeps hitting it escalates instead of
  looping.
- 2026-10-12: repository identity binds, a moved revision does not. -> identity guards against carrying a state
  into another clone or an unrelated worktree; the revision legitimately moves when the handoff commits, so it
  is reported as a note rather than a refusal.
- 2026-10-12: `Task timeout` is checked between steps. -> the runner is sequential and each step already has a
  hard process timeout; pretending to interrupt a running step would be a lie the implementation cannot keep.

## Verification

```bash
node --test tools/cfkit/task.test.ts tools/cfkit/preflight.test.ts   # 19 fixtures: state shape, transition
  # table, fingerprints and escalation, timeout parsing, migration, persistence, and every preflight binding
# live probes (recorded):
#   task begin                -> authorized, effective risk high (max high), lane full, authority edit, verify
#   task preflight            -> ok, 0 paths in scope
#   (plan Authority edited)   -> refuse: "the plan's Authority changed since the task began
#                                (state bb3848a57785…, plan 959562b4364b…)"
#   (planted lint error) verify -> exit 1; phase repairing; failing lint verify.lint x1 (f93b0ee236c6…)
#                                 history verifying -> repairing (attempt failed)
#   (plant removed) verify      -> exit 0; repairing -> running (repair attempt) -> verifying ->
#                                 ready_for_review (every step passed)
#   cleanup -> plans:check green
npm run verify                              # fast profile green
npm run verify:gates                        # 8/8 gates bite
npm run verify:ci                           # ci profile green
```

## Completion Notes

The machine landed with eleven phases, append-only history, plan-derived budgets and a preflight that re-checks
five bindings. The live probe earned its keep twice more: it caught `authorized -> running` skipping the
`preparing` hop, and it showed a failed attempt leaving the task in `verifying` — the repair path is now
structural (failures land in `repairing`, verify resumes from there, repeats count per fingerprint against the
plan's limit). The state layer was split out of `task.ts` when the file-length rule fired, which is the rule
doing its job. Two honest limits are recorded: the timeout is checked between steps rather than interrupting a
running one, and a moved revision is a note because the handoff legitimately commits.
