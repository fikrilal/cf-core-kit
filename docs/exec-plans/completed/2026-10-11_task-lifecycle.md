# Task lifecycle: begin/verify, risk classification, bounded repair (task 5.4)

- Status: completed
- Owner: fikrilal
- Risk: high
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0009 (cfkit CLI and the verify gate); roadmap task 5.4

## Objective

Task governance lands: `cfkit task begin --plan <path>` binds a task to an exec plan (our plan
headers already carry status/risk), classifies risk from changed paths (**may raise the declared
risk, never lower it**), and `cfkit task verify --task <id>` runs the lane-appropriate profile
with bounded repair: repeated failure fingerprints escalate instead of looping.

## Behavior reference

backend-core-kit: plan v2 with authority metadata (allowed paths/actions/max risk/repair limit/
timeout), `effectiveRisk = max(pathRisk, declaredRisk)`, state under a gitignored
`.tmp/backendkit/tasks/<id>/state.json` (atomic writes, 0600), lane selection (low → fast,
medium/high → full, runtime-impacts → + runtime), attempt episodes with
`{code, taskFingerprint, repeatCount}`, `repeatCount > repairLimit → escalated` with "Repair
budget exhausted; request human direction.", fingerprint changes resetting repeat counts.

## Design

- Our plans already carry `- Status:`/`- Risk:` headers plus an Impact Areas list; `task begin`
  validates the plan is under `docs/exec-plans/active/`, extracts status/risk, and records a
  task state in `.cfkit/` (gitignored) with `{taskId, planPath, declaredRisk, effectiveRisk,
allowedPaths, repairLimit, attempt, episodes[]}` — atomic writes, no git-visible artifacts.
- Risk classification: path rules ported from the review skills (`src/platform/auth|storage`,
  `db/migrations`, `wrangler.jsonc`, `package*.json`, `tools/cfkit`, `scripts/budget|drift|
contract`, `src/app.ts|worker.ts|jobs.ts`, docs → low, etc.). `effectiveRisk = max(declared,
classified)`; the classified set can only raise.
- Lane: low → `fast`, medium/high → `full`, runtime-relevant paths (auth, db, queue, storage,
  worker/jobs, contract) → `ci` (full + runtime).
- Bounded repair: `task verify` runs the lane profile, records `{stepId, fingerprint}` on
  failure (fingerprint = step id + normalized first failure lines), increments `attempt`; a
  repeat beyond `repairLimit` (default 3) escalates with "Repair budget exhausted; request
  human direction."; changed fingerprints reset their counters; a passing run clears the
  episode and marks the task verified.
- Commands: `task begin`, `task verify`, `task status` (read-only). No file writes outside
  `.cfkit/`; no commit/push (that is 5.5's handoff under approval).

## Acceptance Criteria

1. Risk classification matrix tested (every rule id, raise-only semantics, unknown → medium).
2. Lane selection tested (low/medium/high, runtime-impacting paths).
3. Bounded repair: injected failures with stable/changing fingerprints exercise
   increment/reset/escalation deterministically.
4. State writes are atomic and confined to `.cfkit/` (fixture test); `verify:ci` green.

## Steps

- [x] Risk classifier + lane selection (pure, table-tested)
- [x] Task state + begin/verify/status + bounded repair
- [x] CLI wiring + tests + bookkeeping

## Decision Log

- 2026-10-11: derive authority from our existing plan headers instead of a new v2 metadata block. -> the plans already declare risk/status/impact in human form; tooling reads the same source it documents
- 2026-10-11: state under gitignored `.cfkit/`, never in git. -> task episodes are local evidence, not repository history

## Impact Areas

- Harness: `tools/cfkit/` (+ `scripts/` for the smoke); Docs/guides change with 5.6; no product
  or contract surface changes outside the manifest moves the endpoint scaffold performs.

## Verification

```bash
node --test tools/cfkit/task.test.ts   # 7 tests: risk rule matrix (every rule id),
                                       # raise-only effective risk, lane selection (low ->
                                       # fast, medium/high -> full, runtime paths -> ci),
                                       # task ids from plan names, declared risk from plan
                                       # headers, bounded repair increments/step isolation/
                                       # escalation/verified-clear, state round-trip under
                                       # .cfkit with duplicate refusal

# live lifecycle on this very plan:
npm run cfkit -- task begin --plan docs/exec-plans/active/2026-10-11_task-lifecycle.md
#   -> task-lifecycle, declared high, effective high (high.harness, ...), lane full
npm run cfkit -- task verify --task task-lifecycle
#   -> full profile ran, status verified, attempt 1/3; state at
#      .cfkit/tasks/task-lifecycle/state.json (gitignored)
npm run cfkit -- task status --task task-lifecycle

npm run test:scripts                   # 92 fixtures
```

## Completion Notes

The lifecycle loop works end to end on the real repository: the plan's own header supplies the
declared risk, the current diff supplies the classification, and the lane runs the composed
profile with bounded repair. Three deliberate simplifications, each recorded rather than
implied: the failure fingerprint is the failing step id (repeating that step past the repair
limit escalates; a different step failing tracks its own count, which is the "changed
fingerprint resets" behavior in the small), state lives only under gitignored `.cfkit/` so
episodes are local evidence and never repository history, and `task verify` marks the task
verified on any passing lane run — a fresh failure afterwards moves it back out of `verified`
through the failure path rather than silently staying green.

The live run classified this very task as `high` through `high.harness` (the tools being
changed are the harness itself), which is the intended raise-only outcome: the declared risk
matched, and the lane correctly chose `full` because no runtime-relevant path (`src/features/`
etc.) was touched, even though the CI-runtime lane exists for those.
