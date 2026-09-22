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
