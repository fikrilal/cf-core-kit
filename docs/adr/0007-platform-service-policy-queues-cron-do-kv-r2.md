# ADR: Platform Service Policy — Queues, Cron, DO, KV, R2

- Status: Accepted
- Date: 2026-10-10
- Decision makers: Core kit maintainers

## Context

The Workers platform offers several stateful and asynchronous primitives with very different free-tier budgets (ADR-0005). The kit needs one policy that decides where jobs, scheduling, coordination, caching, and objects live — before features start picking primitives ad hoc.

## Decision

- **Queues** carry async jobs (notifications, sweeps; email when an email-dependent feature lands). At-least-once delivery: handlers are idempotent by `jobId`; bounded retries with jitter; explicit DLQ policy; 24h retention means handlers stay fast; payloads carry IDs, not blobs.
- **One fan-out cron per project** (the account's 5-trigger budget is shared): enqueue work or poke DOs; never process in the cron itself (10ms CPU).
- **Durable Objects**: hibernation-first, memory-first counters with batched persistence. v1 usage is rate-limit counters for auth paths; ≤ 1 DO request per auth operation; no always-on patterns. A per-user `CredentialKeeper` class is the future home for password/passkey material (backlog, ADR-0006).
- **KV is read-only territory**: in-isolate memoization first; KV for cold-start reads only; never a source of truth or a write path.
- **R2 owns objects**: presigned PUT/GET with direct client transfers; the Worker never proxies payloads.
- **Workflows**: deferred until a concrete multi-step saga exists (3k steps/day when adopted).

## Rationale

Budgets decide placement: KV cannot take writes (1k/day), D1 counters would burn the write budget, and an always-on DO consumes most of the daily GB-s allowance. Consumers and cron are I/O-bound by design; the DO budget is spent only on atomic coordination that nothing else can provide.

## Consequences

Positive: one documented home per concern; features cannot accidentally pick an inappropriate primitive; budgets stay predictable.

Negative: queue 24h retention and 10k ops/day bound job design; DO-heavy coordination is deliberately constrained; Workflows users must first reopen this policy.

## Alternatives Considered

- KV counters for rate limiting — rejected: 1k writes/day and eventual consistency.
- D1-based counters — rejected: doubles write amplification on every rate-limited request.
- Always-on DO scheduler — rejected: ≈10.8k of the 13k GB-s/day budget for one object.
- Workflows for all background work — rejected: step budget and complexity without a current saga.

## Links / References

- Related ADRs: ADR-0004, ADR-0005, ADR-0006
- Related docs: `docs/core/project-architecture.md`
- Related proposals: `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`
