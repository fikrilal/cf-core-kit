# Queued intake and the maintenance registry (harness parity C13)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.6 and §5.7, §7 batch C; ADR-0011

## Objective

Close batch C with the two run-once commands the harness needs to keep itself honest: a queued-plan intake that
cannot promote twice, and a maintenance registry that runs the read-only report steps under one lock.

## Behaviour reference (backend-core-kit)

`events run --once` (queued → active promotion, single-flight, mode-0600 receipts, fail-closed recovery) and
`maintenance run --once` (knowledge, smells, duplication, audit — 15 minutes per step, under the repository lock).

## Design

- `docs/exec-plans/queued/` becomes a real state: a folder README documents the intake, the plan contract applies
  to queued plans (metadata block included), and both an empty and an absent queue are normal.
- `tools/cfkit/events.ts` behind `cfkit events run --once [--dry-run]`:
  - promotion moves one queued plan into `active/`, flips `- Status: queued` to `active`, and refuses anything
    that would not pass the plan contract **as an active plan** — the contract from C10 is the gate;
  - identity is `source + task id + sha256(queued bytes)`, so the same revision can never be promoted twice and
    an edited plan is a new event;
  - receipts are written twice (claimed, then promoted) as mode-0600 files under `.cfkit/events/`;
  - recovery is fail-closed and bounded: a claimed receipt whose file is gone is recorded as completion; a
    claimed receipt whose file is still queued is left alone for a human, because guessing is worse than waiting.
- `tools/cfkit/maintenance.ts` behind `cfkit maintenance run --once`: `plans:check`, `smells:check`,
  `duplication:report`, `audit:prod` in order (fail-fast, 15-minute per-step ceiling inherited from the process
  runner) with one mode-0600 receipt per run under `.cfkit/maintenance/`.
- `tools/cfkit/lock.ts`: the minimal repository lock both commands run under — exclusive creation, recorded pid,
  stale reclaim by **pid liveness** (a corrupt lock file is treated as unheld and reclaimed), release that never
  touches another process's lock, and a `withLock` helper. D15 grows this into the workspace model.

## Constraints

- Nothing is promoted while `active/` holds a file or an **active** task is tracked; a verified or escalated
  state is history and must not freeze the queue (see the decision log — the first guard did).
- The intake promotes at most one plan per run, and never rewrites a plan beyond the status line.
- The maintenance registry reports; it does not repair. It writes receipts and whatever its steps write.
- The lock is a local-run guard, not a distributed one: pids are per-host, and that caveat is in the module.

## Acceptance Criteria

1. A dry run writes nothing and reports what would happen (fixtures, plus a live dry run).
2. A promotion moves the plan, flips the status, writes a mode-0600 receipt and leaves the queue empty (fixtures
   and a live run).
3. Occupied `active/`, an active tracked task, a plan that would fail the contract, and a re-run of the same
   revision are each refused with a precise reason (fixtures).
4. A claimed receipt whose file is gone is recovered as completion (fixture).
5. The registry runs its four steps in order, stops at the first failure, writes receipts (mode 0600), is
   idempotent across runs, and is blocked by a live lock (fixtures); the lock reclaims a dead pid and never
   releases a foreign lock (fixtures).
6. `npm run verify`, `npm run verify:gates` and `npm run verify:ci` are green, and `events.intake` plus
   `maintenance.registry` flip to `present` (32 of 46).

## Steps

- [x] `tools/cfkit/lock.ts`, `tools/cfkit/events.ts`, `tools/cfkit/maintenance.ts`
- [x] `docs/exec-plans/queued/README.md` + CLI commands (`events run`, `maintenance run`) + npm scripts
- [x] fixtures (10 across events/maintenance/lock) + `test:scripts` registration
- [x] live probes (dry run, promotion, single-flight, maintenance with receipts) + manifest flip + bookkeeping

## Decision Log

- 2026-10-12: the promotion gate is the C10 plan contract, evaluated _as an active plan_. -> a queued plan that
  would not survive promotion fails before anything moves, with the contract's own problems as the message.
- 2026-10-12: identity includes the queued bytes. -> "the same plan" is a revision, not a path: re-editing a
  queued plan must be promotable again, and re-submitting identical bytes must not be.
- 2026-10-12: recovery is bounded to what is provably safe. -> completing a promotion whose file is already gone
  is idempotent; a claimed receipt whose file is still queued is _not_ guessed at, because the run may have died
  before or after the write. The next run reports it as recovered only when the file is gone.
- 2026-10-12: the live probe found the folder README being treated as a plan. -> `README.md`/`_template.md` are
  skipped wherever plans are listed, including `queued/` and `active/`, and `plans:check` no longer validates
  folder documentation.
- 2026-10-12: the live probe found the guard too coarse — **any** task state blocked promotion, so two long
  finished tasks from 2026-10-11 (`.cfkit/tasks/phase5-publication`, `.cfkit/tasks/task-lifecycle`) froze the
  queue. -> only `status: "active"` blocks now; finished states are history. Reporting stale states belongs to the
  doctor (D18), which is recorded as a watch item rather than solved here.
- 2026-10-12: the dry run's report distinguishes "would promote" from "refused". -> an empty refusal list once
  printed a bare `refused <plan>:` line, which read like a failure.
- 2026-10-12: the lock trusts pid liveness instead of a timeout. -> a clock-based reclaim would steal a lock from
  a slow-but-alive run; a pid that is gone is unambiguous locally, and the cross-host limitation is documented.

## Verification

```bash
node --test tools/cfkit/events.test.ts tools/cfkit/maintenance.test.ts   # 10 fixtures: dry run, promotion,
  # receipts and modes, occupancy and active-task guards, contract refusal, revision identity, recovery,
  # step order and fail-fast, idempotence, live-lock blocking, stale reclaim, foreign-lock safety
# live probes (recorded):
#   events run --once --dry-run          -> "promoted nothing" with "would promote <plan>"
#   events run --once                    -> promoted docs/exec-plans/active/2026-10-13_probe-intake.md
#                                           receipt .cfkit/events/f9b3f4d4….json mode 600
#   events run --once (again)            -> promoted nothing (active/ occupied; same revision refused)
#   maintenance run --once               -> steps 4; exit 0 (plans:check, smells:check, duplication:report,
#                                           audit:prod) receipt mode 600, lock released
#   cleanup -> active/ empty again, plans:check green
npm run verify                             # fast profile green
npm run verify:gates                       # 8/8 gates bite
npm run verify:ci                          # ci profile green
```

## Completion Notes

Batch C closes with the intake and the registry. The live probes did the heavy lifting again: they caught the
folder README being validated as a plan, the guard freezing the queue behind two finished tasks, and a dry-run
line that read like a failure — all three fixed and pinned by fixtures. The promotion gate is the same plan
contract C10 installed, evaluated as an active plan, so the queue can only ever feed valid work into `active/`.
The repository lock is deliberately minimal and documented as local-only; D15 grows it, and the two stale task
states it exposed (finished on 2026-10-11, still on disk) are recorded as a watch item for the doctor (D18)
rather than silently deleted.
