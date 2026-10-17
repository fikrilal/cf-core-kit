# ADR: Oracles and operating evidence

- Status: Accepted
- Date: 2026-10-15
- Decision makers: Core kit maintainers

## Context

High-risk behaviours were covered by single-feature specs that compose less than the whole surface, and attempts
left no structured memory. Claims like "refresh rotation is verified" could not be traced to evidence that ran
the composed system.

## Decision

Two devices. An **oracle registry** names each high-risk behaviour with an acceptance statement and evidence
paths; `covered` requires at least one path under `test/integration/**` or `test/contract/**` — single-feature
specs are structurally ineligible — and `pending` requires the reason its evidence is not end-to-end. Every
attempt writes a schema-validated **episode** (forbidden keys rejected anywhere, no prompts/streams/environment)
and a sanitized, tail-kept **diagnostic** (16 KiB, redacted) under `.cfkit/tasks/<id>/`, both mode 0600. An
**operating-evidence ledger** records reviewed proof: hashed episodes, the exact revision, a hosted run URL, a
reviewer; its schema admits no free text, so prose and PII are impossible.

## Rationale

Each device answers a question the others cannot: what proof exists, what an attempt actually did, and what a
human reviewed.

## Consequences

Four oracles are covered, four are pending with the exact mechanism each gap needs. The ledger is empty by
design and eligibility (5 tasks / 2 risk classes / one repair) prints its shortfall on every run. `reviewedBy`
proves the field was filled, not who read it — that part stays a human rule and the document says so.

## Alternatives Considered

- Accepting unit-only evidence: the oracle claim would be false.
- A prose evidence log: risks PII, resists validation.

## Links / References

- Related ADRs: 0014 (harness), 0021 (improvement programme)
- Related docs: `docs/engineering/operating-evidence.md`, `docs/engineering/runtime-evidence.md`,
  `docs/standards/testing-strategy.md`
- Related proposals: `_WIP/2026-10-12_harness-parity-proposal.md`
