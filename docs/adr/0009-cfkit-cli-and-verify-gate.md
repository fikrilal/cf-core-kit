# ADR: cfkit CLI and the Verify Gate

- Status: Accepted
- Date: 2026-10-10
- Decision makers: Core kit maintainers

## Context

Each family kit owns a CLI (backendkit, mobilekit, frontendkit, gokit). The kit's developer-experience standard requires the simple path to be the default path and one canonical gate that CI mirrors.

## Decision

- **Today (foundation)**: `npm run verify` is the single gate — format check, lint, typecheck, tests, and a dry-run build. CI runs exactly this target.
- **M1 (platform core)**: `cfkit` CLI arrives with `verify --profile fast|full|runtime|ci`, `scaffold feature`, `remove feature`, `budget:check`, `contract:check`, and `doctor`. Scaffold output must pass the gate untouched; `remove feature` unwires cleanly.
- **M2+**: task lifecycle (`task begin/verify`), risk classification, and handoff (commit/push/draft-PR with explicit per-action authorization) mirror the `backendkit` / `frontendkit` model.
- Generated artifacts (OpenAPI snapshot, parity manifest) are regenerated, committed, and drift-checked once the contract pipeline lands.

## Rationale

A single gate prevents check drift between local runs and CI, and makes "verified" mean one thing. Scaffolding keeps feature work small without inventing runtime abstractions; boilerplate is generated and removable, not abstracted away.

## Consequences

Positive: new endpoints start green; one command to trust; profiles scale verification cost by risk later.

Negative: `cfkit` is maintained with the kit, and its templates must track convention changes; full task governance is intentionally deferred until feature work begins.

## Alternatives Considered

- Scripts only, no CLI — rejected: cannot scaffold or unwire features, and the family expects a harness.
- Full harness parity from day one — rejected: building governance before product code delays the platform core.

## Links / References

- Related ADRs: ADR-0008
- Related docs: `AGENTS.md`, `README.md`
- Related proposals: `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`
