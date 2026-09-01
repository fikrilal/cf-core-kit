# ADR: D1 with Drizzle as the Data Plane

- Status: Accepted
- Date: 2026-10-10
- Decision makers: Core kit maintainers

## Context

The kit must run on the Workers Free plan with no external database service. D1 is Cloudflare's SQLite-family database, available on free with daily allowances (5M rows read / 100k rows written / 5GB). The family treats the data layer as independent from the wire contract (ADR-0002).

## Decision

- **D1 + Drizzle** as the baseline data plane. Repositories sit behind ports; features never touch bindings or SQL drivers directly.
- **Migrations**: drizzle-kit generates SQL migrations, applied via `wrangler d1 migrations`; migrations are committed and reviewed, and no runtime DDL runs.
- **Transaction semantics**: D1 has no interactive multi-await transactions. Multi-statement atomic writes use `batch()` or single statements; cross-request consistency is handled with idempotency keys and status machines.
- **Write discipline**: ≤ 2–3 rows written per API write request, index amplification included. Indexes are added only for proven read patterns; each index on a written column adds a write.
- **Durable state lives in D1**: sessions/refresh tokens (rotation + reuse detection), idempotency records (`in_progress` → `completed`, cached response, TTL), user records. KV is never a source of truth (ADR-0007).
- **Postgres/Hyperdrive** stays an optional future adapter behind repository ports — never a v1 baseline.

## Rationale

D1 is the only free-tier-viable relational store inside Cloudflare, and its row-counted billing matches the kit's write-discipline model. Drizzle keeps SQL visible and typed without the CPU/bundle weight of Node ORMs.

## Consequences

Positive: no external database; one migration path; write budgets are explicit and checkable.

Negative: no interactive transactions (design constraint on multi-table invariants); row-read amplification is a discipline, not a compiler error; SQLite-family limits (single primary writer) apply.

## Alternatives Considered

- Hyperdrive + external Postgres as baseline — rejected: external service cost and operations against the free-tier goal; kept as a future port adapter.
- KV for sessions/idempotency — rejected: eventual consistency and 1k writes/day make it unsafe for correctness-critical state.
- Prisma — rejected: CPU and bundle cost on Workers.

## Links / References

- Related ADRs: ADR-0002, ADR-0005, ADR-0007
- Related docs: `docs/core/project-architecture.md`
- Related proposals: `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`
