# The improvement programme (disabled by construction)

The harness may improve _itself_ — but only with the same discipline it asks of every change. This document is
the contract; `npm run improve:check` is the gate, and the programme refuses to run until the gate opens.

## The gate

`improve analyze` and `improve shadow` require reviewed **operating evidence**: at least 5 reviewed tasks, 2 risk
classes and one repair or escalation in `operating-evidence-ledger.json`. The ledger is empty by design, so both
commands answer `ineligible` with the shortfall. That is the honest state: a programme that improves the harness
on the strength of unreviewed work would be guessing with extra steps.

## Entries

`docs/engineering/improvements-ledger.json` (schema 1, empty):

| Field                        | Meaning                                                |
| ---------------------------- | ------------------------------------------------------ |
| `id`                         | kebab-case, unique                                     |
| `status`                     | `proposed → approved → evaluating → kept \| reverted`  |
| `owner` / `approver`         | **must differ** — an improvement cannot approve itself |
| `invariants`                 | the checks it must satisfy (below)                     |
| `paths`                      | what it may edit, inside the improvement surface       |
| `proposedOn` / `evaluatedOn` | dates; `evaluatedOn` is required once kept or reverted |

## Invariants

| Invariant                    | Means                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `authority.no-expansion`     | the change never widens what the harness may do on its own                   |
| `evidence.no-sensitive-data` | no prompts, streams, environment, credentials or addresses enter an artifact |
| `publication.no-expansion`   | no new automatic push, merge or deploy                                       |
| `risk.no-lowering`           | a declared risk may only rise                                                |
| `verification.no-weakening`  | no gate, threshold or fixture may be loosened without a recorded measurement |

## Surface and authority

An improvement may edit: `tools/cfkit/**`, `scripts/**`, `docs/engineering/**`, `docs/adr/**`,
`docs/exec-plans/**`, `.github/workflows/**`, `package.json`, `package-lock.json`. Nothing under `src/**`,
`contracts/**`, `db/**` or `docs/standards/**` — the product surface and the normative standards are not the
programme's to change. Its authority is exactly `edit, verify`: no commit, no push, no release.

## Shadow windows

An improvement is evaluated in a shadow window: the invariant being checked is measured on real evidence _before_
the change is kept, and `kept`/`reverted` requires `evaluatedOn`. A kept improvement without a comparison is a
reverted improvement in disguise.

## What exists today

The machinery: the schema, the invariants, the approver rule, the surface rules, the gate and its report. The
ledger is empty, eligibility is unmet, and `analyze`/`shadow` say so.
