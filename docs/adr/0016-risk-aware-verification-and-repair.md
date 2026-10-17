# ADR: Risk aware verification and repair

- Status: Accepted
- Date: 2026-10-15
- Decision makers: Core kit maintainers

## Context

Every change ran the same verification, so the harness could not tell a docs edit from a schema change, and a
failing step was retried by hand with no memory of what had already failed.

## Decision

Classify a diff by risk (raise-only) and let it select the lane: `fast`, `full`, `gates`, `runtime`, `smoke` or
`ci`, where runtime-relevant paths force the heavier lane. Count failures by fingerprint
(`sha256(stepId:code)`), so two different failures on one step are two entries. Take the repair limit and the
timeout from the plan; escalate with stop reasons `task.repair-limit` and `task.timeout`. A failed attempt lands
in `repairing`, and the next verify resumes from there. The mutation pilot samples whether the assertions
around the policy files can fail at all.

## Rationale

Lanes make the classifier load-bearing rather than advisory, fingerprints stop one flaky step from consuming
another failure's budget, and plan-derived budgets keep the plan as the authority (ADR-0015).

## Consequences

The CI pipeline mirrors the lanes: `risk` publishes what the classifier decided, `full`, conditional `runtime`
and pull-request `governance` consume it, and `required` aggregates them. Timeouts are checked between steps —
a step that hangs is bounded by the process runner, not by interruption. The pilot found a real survivor on its
first run (an id asserted through the constant it pinned).

## Alternatives Considered

- One uniform profile: simple, and blind to risk.
- Step-id counters: conflate unrelated failures.
- Stryker: its runners do not match the Workers pool; the seeded catalogue answers the same question.

## Links / References

- Related ADRs: 0014 (harness), 0015 (task authority)
- Related docs: `docs/engineering/guardrails.md`, `docs/standards/testing-strategy.md`
- Related proposals: `_WIP/2026-10-12_harness-parity-proposal.md`
