# ADR: In-scope surface is auth and users

- Status: Accepted
- Date: 2026-10-12
- Decision makers: Core kit maintainers

## Context

The pinned backend-core-kit snapshot contains 34 operations. Twenty-one are implemented, and the
remaining thirteen split into two groups: `auth.password.*` (5), already descoped by ADR-0006, and
`admin.*` (6) plus `merchantOnboarding.*` (2), which the parity manifest still tracked as a "tier-2
parity backlog" with instructions to scaffold them once a product wanted them.

Those eight operations are not part of this kit's product surface. The admin console and the merchant
onboarding flow are separate products with their own authorization models, data access, and release
cadence; serving their endpoints from the client-facing core kit would blur the boundary the parity
manifest exists to make explicit, and would leave permanently undecided "pending" work in a gate.

## Decision

The in-scope surface of cf-core-kit is the client-facing auth and users surface: every `auth.*`
operation except `auth.password.*`, every `users.me.*` operation, and `health`/`ready`. Everything
else in the pinned snapshot is recorded as descoped:

- `admin.*` and `merchantOnboarding.*` — out of scope; owned by their own products.
- `auth.password.*` — descoped by ADR-0006 (OIDC-first, no password material).

`tools/parity/coverage.json` therefore carries no `pending` operations; the parity gate reports
implemented + descoped, and `cfkit scaffold endpoint` no longer offers operations this kit will not
serve.

## Rationale

- A parity manifest is a classification of the entire pinned surface, not a wish list: leaving
  out-of-scope operations "pending" makes the gate permanently incomplete and invites scaffolding code
  no product owns.
- Scope is a decision, not a backlog: it belongs in an ADR with explicit revisit triggers, next to
  ADR-0006's password descope.
- The wire contract stays the family's: the pinned snapshot is unchanged, and the descoped entries keep
  the reason and the ADR that justifies them visible in the gate output.

## Consequences

- Positive: the parity gate reads "implemented 21 / descoped 13 / pending 0"; scaffolds and roadmap
  language no longer suggest work this kit will never own; the scope question can be answered from one
  ADR.
- Negative: if a family product later needs an admin or onboarding endpoint served from this kit, the
  descope must be revisited (a new ADR superseding this one) rather than resumed from a backlog item.
- Neutral: the pinned snapshot, the emitted document, and the runtime surface are unchanged; only the
  classification and its documentation move.

## Alternatives Considered

- **Keep them pending indefinitely.** Rejected: a gate that can never pass is not a gate, and the
  scaffold tool would keep proposing unowned endpoints.
- **Implement the admin surface here for completeness.** Rejected: it would require an RBAC and audit
  product surface (plus the corresponding tests and budgets) that no consumer has asked for, and it
  would expand the free-tier budget footprint for endpoints nobody calls.
- **Delete the operations from the pinned snapshot.** Rejected: the snapshot is the family's contract,
  owned by backend-core-kit; this kit follows it and never edits it (ADR-0002).

## Links / References

- Related ADRs: ADR-0002 (wire-contract parity), ADR-0006 (OIDC-first, password descoped)
- Related docs: `docs/exec-plans/roadmap.md`, `tools/parity/README.md`
- Related proposals: none
