# ADR: Structured task authority

- Status: Accepted
- Date: 2026-10-15
- Decision makers: Core kit maintainers

## Context

The original task tracker had three states, a free-form repair counter and no binding to the plan it claimed to
implement. Anything could be "active", and nothing checked whether the work still matched what the plan
authorised.

## Decision

The task is bound to its plan and moves through eleven phases (`queued`, `authorized`, `preparing`, `running`,
`verifying`, `repairing`, `ready_for_review`, `escalated`, `cancelled`, `failed`, `handed_off`) with an
append-only history in `state.json` (schema 2, mode 0600). `begin` records the plan's authority (hashed), allowed
paths and actions, maximum risk, repair limit and timeout, plus the repository identity and base revision.
`preflight` re-checks five bindings before any work: the plan exists and still declares this task, its
`Authority` hashes to the recorded value, the action is authorised, the paths the task itself touched are inside
`Allowed paths`, and the effective risk has not climbed past `Maximum risk`.

## Rationale

The plan is the authority; everything else is bookkeeping. Hashing the authority list makes an edited plan
invalidate the task instead of silently widening it, and scoping only the task's own paths keeps a busy working
tree from failing a task it did not dirty.

## Consequences

Illegal transitions are refused rather than written; a state cannot be carried into another repository; a plan
edit forces a re-begin. Schema 1 states migrate on read and say so in their history. A moved revision is a note,
because the handoff legitimately commits.

## Alternatives Considered

- Trusting the plan's metadata without binding: decorative, as the original tracker showed.
- A free-form state string: no exhaustive handling, no refusal.

## Links / References

- Related ADRs: 0011 (gate honesty)
- Related docs: `docs/exec-plans/README.md`, `docs/engineering/agent-loop.md`
- Related proposals: `_WIP/2026-10-12_harness-parity-proposal.md`
