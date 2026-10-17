# ADR: Canonical harness with a parity manifest

- Status: Accepted
- Date: 2026-10-15
- Decision makers: Core kit maintainers

## Context

The reference family runs its harness as the operational standard: verification profiles, a failure taxonomy,
a task machine, evidence machinery and gates that prove themselves. This repository had a partial harness — one
verify command, a small CLI, and script fixtures — but no way to say "we match the family" that anyone could
check.

## Decision

Adopt the family's harness model and make the parity claim falsifiable. One verification core with profiles
(fast, full, gates, runtime, smoke, ci), a failure taxonomy with stable codes, and a parity manifest
(`tools/parity/harness.json`) whose `present` rows must name an existing path or a real npm script. Every row also
maps to the family artifact it was ported from (`tools/parity/family-map.json`), and a tree check validates the
map offline against our manifest and — when a family checkout is given — against the family tree itself.

## Rationale

A parity list kept in prose drifts silently. The manifest plus the tree map turn "1:1 with the family" into a
claim that fails when the evidence disappears, and the deviation field forces every gap to be recorded with a
reason rather than omitted.

## Consequences

The manifest stands at 46 of 46 rows `present`, with 43 family paths verified live and three recorded
deviations. The live tree comparison needs the family checkout, which CI does not have; the offline half is what
CI runs. Adding a row means adding evidence, not a sentence.

## Alternatives Considered

- No manifest: cheaper, but the claim would be unverifiable.
- Porting the family's TypeScript wholesale: its runner and DI shapes do not fit the Workers pool.

## Links / References

- Related ADRs: 0009 (cfkit CLI and verify gate), 0011 (gate honesty)
- Related docs: `docs/engineering/guardrails.md`, `docs/engineering/cfkit.md`
- Related proposals: `_WIP/2026-10-12_harness-parity-proposal.md`
