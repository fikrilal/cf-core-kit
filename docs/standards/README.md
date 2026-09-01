# Standards (normative)

Standards are normative. If you need to deviate, add an ADR and document the exception.

The wire-contract behaviors are owned by backend-core-kit's standards. This kit mirrors them; the standards below are adapted here as the corresponding platform code lands. Until a standard appears in this directory, backend-core-kit's `docs/standards/` is authoritative for its topic.

| Standard                     | Status  | Lands with                                    |
| ---------------------------- | ------- | --------------------------------------------- |
| free-tier-budget             | planned | platform core (first standard — see ADR-0005) |
| api-response                 | planned | platform core (`http`)                        |
| error-codes                  | planned | platform core                                 |
| contract-parity              | planned | contract pipeline                             |
| authentication               | planned | auth slice                                    |
| pagination-filtering-sorting | planned | platform core (list query)                    |
| configuration                | planned | platform core (config)                        |
| database                     | planned | platform core (db)                            |
| queues-jobs                  | planned | background phase                              |
| observability                | planned | platform core                                 |
| testing-strategy             | planned | platform core                                 |
| ci-cd                        | planned | foundation follow-up                          |
