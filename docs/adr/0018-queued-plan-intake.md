# ADR: Queued plan intake

- Status: Accepted
- Date: 2026-10-15
- Decision makers: Core kit maintainers

## Context

Plans were written straight into `active/` by hand. Nothing prevented two active plans, nothing recorded that a
promotion happened, and a crash between "chose a plan" and "moved it" left no trace.

## Decision

Add `docs/exec-plans/queued/` and promote exactly one plan per run (`cfkit events run --once [--dry-run]`).
Promotion passes the plan contract **as an active plan** before anything moves, and the identity is
`source + task id + sha256(queued bytes)`, so the same revision cannot be promoted twice while an edited plan is
a new event. Receipts are written claimed-then-promoted as mode-0600 files under `.cfkit/events/`; recovery is
bounded to what is provably safe (a claimed receipt whose file is gone is recorded as completion).

## Rationale

A receipt makes the intake idempotent across crashes, and the contract gate means the queue can only ever feed
valid work into `active/`.

## Consequences

The intake refuses while `active/` holds a file or an active task is tracked; finished task states no longer
block it. Folder documentation (`README.md`) is not a plan anywhere plans are listed. The same reasoning applies
to the maintenance registry, which runs its four read-only steps under the same lock.

## Alternatives Considered

- Manual moves: no receipt, no recovery, no guard.
- Promoting many plans per run: defeats single-flight and the active-plan limit.

## Links / References

- Related ADRs: 0015 (task authority), 0014 (harness)
- Related docs: `docs/exec-plans/queued/README.md`, `docs/engineering/agent-loop.md`
- Related proposals: `_WIP/2026-10-12_harness-parity-proposal.md`
