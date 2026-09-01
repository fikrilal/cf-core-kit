# ADR: Hono with a zod-openapi Contract Pipeline

- Status: Accepted
- Date: 2026-10-10
- Decision makers: Core kit maintainers

## Context

The kit needs an HTTP layer for Workers that supports the family's contract-first discipline: committed OpenAPI snapshot, lint gates, and generated artifacts with drift checks. Family kits use layered middleware with a fixed order and platform-owned response rendering.

## Decision

- **Router**: Hono — thin, Workers-native, middleware-oriented.
- **Schemas**: zod (>= 4.5 for memory behavior on Workers) for request/response schemas and runtime validation.
- **Contract pipeline**: route definitions generate `docs/openapi/openapi.yaml` (committed), linted with Spectral (family rules: `operationId`, tags, `x-error-codes` required) plus a snapshot drift check.
- **Middleware order is fixed**: request-id → logging → auth → validation → handler → envelope/problem. Platform helpers render `{ data, meta? }` envelopes and RFC7807 problem details; features never construct raw data responses.
- **Errors**: typed codes from the shared error-code union; a single problem mapper renders failures.

## Rationale

Hono keeps the request kernel small and Workers-native while the contract pipeline (not the framework) carries the parity burden. zod doubles as the validation source for both runtime and snapshot generation, so schemas cannot drift from documentation.

## Consequences

Positive: one schema source for validation and OpenAPI; middleware order is explicit and testable; generated artifacts follow the family drift-gate pattern.

Negative: zod CPU cost must be watched under the 10ms budget (measured per ADR-0005 rules); route definitions carry both handler and schema concerns.

## Alternatives Considered

- Bare Workers + itty-router — rejected for v1: hand-rolls validation, OpenAPI generation, and middleware that Hono already provides.
- Node-style frameworks (Express-like) — rejected: bundle size and conventions against the kit's cost goals.
- Code-first OpenAPI with no runtime validation — rejected: two sources of truth.

## Links / References

- Related ADRs: ADR-0002, ADR-0005
- Related docs: `docs/core/project-architecture.md`
- Related proposals: `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`
