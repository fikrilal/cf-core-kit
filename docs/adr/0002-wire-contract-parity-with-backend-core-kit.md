# ADR: Wire-Contract Parity with backend-core-kit

- Status: Accepted
- Date: 2026-10-10
- Decision makers: Core kit maintainers

## Context

frontend-core-kit and mobile-core-kit clients already speak backend-core-kit's wire contract: envelope `{ data, meta? }`, RFC7807 problem details with stable `code` + `traceId`, `X-Request-Id` echo, idempotent writes, cursor lists, and first-party session tokens. cf-core-kit must be indistinguishable for the implemented surface, and drift must fail CI.

The v1 scope deliberately descopes password authentication (`auth.password.*`); OIDC is the sign-in method. This is a scoped-surface decision, not a dialect change.

## Decision

Adopt a three-layer parity model:

| Layer            | Definition                                                                        | Parity requirement                                           |
| ---------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Wire contract    | Paths, methods, JSON schemas, status codes, headers, error codes, token semantics | Identical for every implemented operation — machine-verified |
| Behavior details | Rate-limit thresholds, `title` copy, timing, email content                        | Matched where clients observe them; asserted where they do   |
| Data layer       | Schema, storage engine, formats                                                   | Independent (D1 here; Postgres/SQLite in siblings)           |

Mechanisms:

1. Route definitions generate a committed `docs/openapi/openapi.yaml` in the same artifact shape as backend-core-kit (dotted operationIds, `x-error-codes` per operation).
2. A parity manifest (`tools/parity/coverage.json`) tracks `implemented` (operation allowlist), `pending`, and `descoped` operations against the pinned backend snapshot; CI fails when an implemented operation is missing from the snapshot or its shape drifts.
3. `descoped` holds `auth.password.*` with the ADR-0006 reference and a revisit note. Descoped operations are **not mounted** — no stub routes returning placeholder codes.
4. Contract tests assert dialect invariants on live responses: envelope, RFC7807 (`code` + `traceId`), `X-Request-Id` echo, 204 semantics, and validation error shape.
5. Downstream kits retarget by swapping `provenance.json` in their existing contract sync; the snapshot artifact shape matches backend-core-kit's.

## Rationale

Clients branch on codes and headers, not just schemas, so parity must be a CI result rather than a claim. The three-layer model keeps data storage independent — the Go and Cloudflare kits store data differently while remaining contract-identical for clients.

## Consequences

Positive: drift fails CI; the implemented surface is explicit and machine-checked; the descope is visible, documented, and reversible.

Negative: snapshot updates are coordinated pull steps from backend-core-kit; each descoped operation is a documented client-visible gap until revived.

## Alternatives Considered

- Hand-mirrored types and docs — drift-prone; rejected.
- Stub routes returning a placeholder problem code for descoped operations — rejected: advertises operations that can never work here.
- Full contract parity in v1 including passwords — rejected: free-tier CPU limits and the PBKDF2 iteration cap make password verification unsafe or weak (ADR-0006).

## Links / References

- Related ADRs: ADR-0003, ADR-0006
- Related docs: `docs/core/project-architecture.md`
- Related proposals: `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`
