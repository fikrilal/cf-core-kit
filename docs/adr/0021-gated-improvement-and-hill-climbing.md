# ADR: Gated improvement and hill climbing

- Status: Accepted
- Date: 2026-10-15
- Decision makers: Core kit maintainers

## Context

The family runs a programme that improves the harness itself, with an improvement ledger, invariants, a distinct
approver and shadow evaluation. Ported without its gate, it would let the harness change itself on unreviewed
work.

## Decision

Port the machinery **with its gating**: an improvement ledger (`proposed → approved → evaluating → kept |
reverted`), five invariants (`authority.no-expansion`, `evidence.no-sensitive-data`, `publication.no-expansion`,
`risk.no-lowering`, `verification.no-weakening`), an approver who must differ from the owner, a harness-only edit
surface (`tools/cfkit/**`, `scripts/**`, `docs/engineering/**`, `docs/adr/**`, `docs/exec-plans/**`,
`.github/workflows/**`, `package.json`, `package-lock.json`), authority exactly `edit, verify`, and shadow
windows. `improve analyze` and `improve shadow` report the operating-evidence shortfall and refuse while the
programme is ineligible. Alongside it, the escalation ladder is the rule for ordinary work: **same failure twice
⇒ automate it**, fixture it, gate it, document its home; recalibrate thresholds from measured runs rather than
relaxing them; and record every deliberate non-port.

## Rationale

A programme that improves the harness on unreviewed work is guessing with extra steps. The gate is the
deliverable; the machinery is ready for the day the evidence exists.

## Consequences

The ledger is empty, eligibility is unmet, and `analyze`/`shadow` exit non-zero with the shortfall. The
repository's own harness work already followed the ladder — the CI lane fix and the duplication runner fix each
came with the check that would have caught them.

## Alternatives Considered

- Running the programme immediately: no evidence, no invariants worth trusting.
- Documentation only: the invariants would be prose nobody executes.

## Links / References

- Related ADRs: 0011 (gate honesty), 0020 (oracles and evidence)
- Related docs: `docs/engineering/improvements.md`, `docs/engineering/hill-climbing.md`,
  `docs/engineering/guardrails.md`
- Related proposals: `_WIP/2026-10-12_harness-parity-proposal.md`
