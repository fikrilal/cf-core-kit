# ADR: Boundaries and Budget Guardrails as Executable Rules

- Status: Accepted
- Date: 2026-10-10
- Decision makers: Core kit maintainers

## Context

Family kits encode boundaries as executable rules (backend's dependency-cruiser, mobile's architecture lints, frontend's architecture sensor, Go kit's depguard). Review memory does not scale, and the free-tier budget adds rules that are just as mechanical (KV writes, crypto allowlist, bundle size).

## Decision

Boundaries and budget guardrails are enforced by lint rules and verify-gate checks, not review memory:

**Dependency boundaries (eslint / import rules):**

- `src/platform/**` must not import `src/features/**`;
- `src/features/**` must not import `src/worker.ts` or app entry modules;
- `src/shared/**` stays framework-free (no Workers-specific APIs);
- cross-feature imports only through a feature's exported surface, allowlisted per pair, acyclic.

**Platform-only capabilities:**

- raw binding access (`env.*`) only inside `src/platform/config` and platform modules; features receive typed ports/values;
- KV writes only in allowlisted maintenance paths;
- crypto allowlist: Ed25519/ES256 sign+verify, RS256 verify for OIDC ID tokens; no RSA signing; no KDFs while password is descoped (ADR-0006);
- `new Date()` / `Date.now()` forbidden in service/domain code — injected `Clock`;
- features must not construct raw data responses — platform helpers render envelopes and problem details.

**Budget checks (verify gate):**

- bundle-size budget;
- cron-trigger count;
- `env` access confinement;
- crypto allowlist;
- per-endpoint declared write/subrequest budget review for new routes.

**Escalation rule (family):** when the same class of failure appears twice, promote it into a lint rule, check, scaffold update, or doc.

## Rationale

Rules that matter must fail builds, not reviews. The free-tier budget makes some architectural rules numerical (writes per request, bundle size), so they belong in the same enforcement family as import boundaries. Rules stay few, explicit, and searchable.

## Consequences

Positive: architecture and budget regressions surface mechanically in CI; scaffolding can be generated to pass the rules.

Negative: the lint/check configuration is a maintained artifact and must evolve deliberately when architecture changes.

## Alternatives Considered

- Review discipline and docs only — rejected: does not scale to agent-assisted contributions.
- A separate custom static-analysis tool — deferred: eslint plus small budget scripts cover v1; revisit if checks outgrow them.

## Links / References

- Related ADRs: ADR-0001, ADR-0005
- Related docs: `docs/core/project-architecture.md`, `AGENTS.md`
- Related proposals: `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`
