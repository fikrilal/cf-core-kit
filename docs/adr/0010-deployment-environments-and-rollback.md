# ADR: Deployment Environments and Rollback

- Status: Accepted
- Date: 2026-10-10
- Decision makers: Core kit maintainers

## Context

The deploy unit is a single Worker plus its bindings. D1 migrations and code do not roll back atomically, and the free tier has failure modes (daily request cap, CPU limits, write-limit exhaustion) that must be understood before they happen.

## Decision

- **Environments**: wrangler environments map `dev` / `staging` / `prod` with per-environment bindings and vars; secrets via `wrangler secret`. Environment blocks land with the deployment phase.
- **Deploy**: `wrangler deploy` per environment; the previous Worker version is the rollback unit (wrangler versions/deployments).
- **Schema safety**: D1 migrations must be backward-compatible for one deploy cycle (expand → migrate → contract); no destructive migration in the same deploy that removes its last reader.
- **CI**: same gate as local (`npm run verify`, ADR-0009); staging deploys from main, prod from tags, both gated by verification and explicit authorization. GitHub Actions are pinned by tag today; SHA pinning + least-privilege permissions land with CI hardening (parity with backend-core-kit's CI standard).
- **Failure modes documented, not discovered**: `1027` (daily request cap — choose fail-open vs fail-closed per route), `1102` (CPU limit — monitor invocation statuses), D1 write-limit exhaustion, queue 24h message expiry.

## Rationale

A template kit should make the safe path obvious: one deploy unit keeps rollback simple, expand/migrate/contract keeps schema changes reversible for one cycle, and documented failure modes make free-tier limits an operational model rather than a surprise.

## Consequences

Positive: deployment and rollback are boring; schema changes cannot strand old code mid-deploy; budget failures are anticipated with chosen behaviors.

Negative: migrations take two deploy cycles for destructive changes; CI hardening (SHA pinning, permissions) is explicitly deferred and tracked.

## Alternatives Considered

- Per-PR preview deployments as a baseline — deferred: useful but not required to be operable; can be added without changing this decision.
- Direct-to-prod deploys without staging — rejected: removes the runtime evidence lane.

## Links / References

- Related ADRs: ADR-0005, ADR-0009
- Related docs: `docs/core/project-architecture.md`
- Related proposals: `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`
