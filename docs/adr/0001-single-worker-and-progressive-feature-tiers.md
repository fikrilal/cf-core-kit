# ADR: Single Worker and Progressive Feature Tiers

- Status: Accepted
- Date: 2026-10-10
- Decision makers: Core kit maintainers

## Context

cf-core-kit is the Cloudflare member of the core-kit family. It must serve the backend-core-kit wire contract from Workers, where the deploy unit is a Worker script and the platform provides queues, cron, and Durable Objects as bindings rather than processes.

backend-core-kit ADR 0018 and mobile-core-kit ADR 0009 established the family's progressive feature architecture: start with the smallest structure that fits, promote only on explicit triggers.

## Decision

Ship one Worker script per deployment. All handlers live in the same script:

- `fetch` — HTTP API;
- `queue` — background job consumer;
- `scheduled` — cron triggers;
- Durable Object classes — stateful coordination.

Feature tiers are progressive, adopted from the family:

| Tier             | Use when                                                                         | Shape                                                              |
| ---------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Endpoint slice   | Simple CRUD, reads/lists, one repository, no complex invariant                   | routes, optional service, repository, colocated tests              |
| Capability slice | Multiple related endpoints share behavior, policies, or persistence              | capability folders under the feature with shared repository/errors |
| Clean slice      | Auth, deletion, queue workflows, transaction-heavy invariants, multiple adapters | explicit `app/` / `infra/` structure                               |

Promotion triggers (any one): pure rules needing independent tests; one use case needing multiple adapters; external side effects orchestrated through ports; transactions spanning aggregates; queue retries, idempotency, or eventual consistency affecting correctness; auth/session/security-sensitive change; feature expected to be extracted; complex repository behavior.

Use cases are optional (mobile-core-kit rule): a service exists only when the operation has logic worth isolating — a final validation gate, multi-step orchestration, or a rule worth its own test. Pure pass-throughs are forbidden; the handler calls the repository directly.

## Rationale

The platform already provides handler separation without process separation, and free-tier budgets punish extra deploy units. Progressive tiers keep simple features small without giving up structure where risk demands it.

## Consequences

Positive: one deploy unit and one composition root; simple features stay few files; complex slices can still grow explicit structure.

Negative: promotion triggers are reviewed, not lint-enforced; splitting into multiple Workers later means introducing service bindings (deferred, not precluded).

## Alternatives Considered

- Multi-worker topology from day one (API / consumer / scheduler split) — deferred: extra deploy units and wiring without a scaling driver on the free tier.
- Mandatory clean layers for every feature — rejected: ceremony without corresponding risk.
- Runtime DI container — rejected: family style is explicit composition; no container in the proposal.

## Links / References

- Related ADRs: ADR-0008, ADR-0009
- Related docs: `docs/core/project-architecture.md`
- Related proposals: `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`
