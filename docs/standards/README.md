# Standards (normative)

Standards are normative. If you need to deviate, add an ADR and document the exception.

The wire-contract behaviors are owned by backend-core-kit's standards. This kit mirrors them; the standards below are adapted here as the corresponding platform code lands. Until a standard appears in this directory, backend-core-kit's `docs/standards/` is authoritative for its topic.

| Standard                     | Status    | Where the rules live                |
| ---------------------------- | --------- | ----------------------------------- |
| free-tier-budget             | normative | this directory (landed 2026-10-11)  |
| queues-jobs                  | normative | this directory (landed 2026-10-11)  |
| observability                | normative | this directory (landed 2026-10-11)  |
| testing-strategy             | normative | this directory (landed 2026-10-11)  |
| database                     | normative | this directory (landed 2026-10-11)  |
| ci-cd                        | normative | this directory (landed 2026-10-11)  |
| configuration                | guide     | `docs/guide/config.md` + zod schema |
| api-response                 | family    | backend-core-kit (mirrored + gated) |
| error-codes                  | family    | backend-core-kit (mirrored + gated) |
| contract-parity              | family    | backend-core-kit (mirrored + gated) |
| authentication               | family    | backend-core-kit (mirrored + gated) |
| pagination-filtering-sorting | family    | backend-core-kit (mirrored + gated) |

Statuses: `normative` — the standard lives in this directory; `guide` — the practical rules
and key table live in `docs/guide/config.md`, with the zod schema as the machine truth;
`family` — the wire-contract behavior is owned by backend-core-kit's standards, this kit
mirrors it, and the mirroring is enforced by `contract:check`, the parity manifest, Spectral,
and the dialect suite rather than by prose here.

## Family-owned topics (status: family)

The reference family owns these standards; this repository follows the contract and does not restate them. Where
we enforce a rule, it is listed with the gate in `docs/engineering/guardrails.md` rather than duplicated here.

| Topic                                     | Family document                | What we enforce locally                                                               |
| ----------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------- |
| API response envelope and problem details | `api-response-standard`        | the contract suite (`test/contract/dialect.spec.ts`) and the emitted OpenAPI document |
| Error codes                               | `error-codes`                  | `src/shared/error-codes.ts` as the only source of codes; raw literals are a smell     |
| Authentication                            | `authentication`               | sessions, refresh rotation and OIDC notes under `docs/engineering/auth/`              |
| Authorization / RBAC                      | `authorization-rbac`           | not implemented beyond roles in the access token (v1 surface)                         |
| Configuration                             | `configuration`                | `config:check` (wrangler vars ↔ schema ↔ documented secrets)                          |
| Code quality                              | `code-quality`                 | eslint, prettier, the duplication harness, the smell scanner                          |
| Pagination, filtering, sorting            | `pagination-filtering-sorting` | `src/shared/list-query/` and the contract suite's list dialect                        |
| Reliability                               | `reliability`                  | idempotent writes, queue retries, the free-tier budget gates                          |
| Security                                  | `security`                     | the secrets scan, the rate limiter, the crypto allowlist (ADR-0006)                   |

A topic becomes **normative** here when we own a rule the family does not state; until then, this table is the
pointer and the local enforcement row is the proof.
