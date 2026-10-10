# Operating evidence (normative)

Status: normative (landed 2026-10-13). The ledger starts empty and stays advisory; this document is the
contract the checker enforces.

## Purpose

The ledger answers one question: _which behaviours were verified in a hosted lane, on which exact revision, and
who reviewed that fact?_ It is the memory the improvement programme reads before it may propose anything, and it
is deliberately boring — ids, enums, hashes, revisions, URLs and dates, nothing else.

## What an entry is

| Field         | Shape                                                          |
| ------------- | -------------------------------------------------------------- |
| `taskId`      | kebab-case task id (the exec-plan slug)                        |
| `risk`        | `low` \| `medium` \| `high` (the effective risk of the run)    |
| `lane`        | `fast` \| `full` \| `gates` \| `runtime` \| `smoke` \| `ci`    |
| `outcome`     | `verified` \| `escalated`                                      |
| `attempts`    | integer ≥ 1                                                    |
| `repairs`     | integer ≥ 0 (bounded repair reruns)                            |
| `escalations` | integer ≥ 0, never above `attempts`; required when `escalated` |
| `episodeHash` | sha256 of the attempt episode (`.cfkit/tasks/<id>/episodes/…`) |
| `revision`    | the exact 40-character revision the lane ran on                |
| `ciRunUrl`    | a hosted CI run URL (GitHub Actions run or GitLab pipeline)    |
| `reviewedBy`  | a short handle of the human who reviewed it                    |
| `reviewedOn`  | `YYYY-MM-DD`                                                   |

## What may never appear

There is no free-text field. Prose, prompts, reasoning, raw streams, environment dumps, tokens, connection
strings, customer data and PII are all **structurally** impossible: unknown keys are rejected, address-like or
multi-line values are rejected, and every field is an id, an enum, a hash, a revision, a URL or a date. An
observation that does not fit belongs in the plan, the ADR or the pull request — not here.

## The review rule

`reviewedBy` records that a human read the episode and the run, and the reviewer must not be the author of the
change. That rule is a **process** rule: the checker can require the field, and cannot verify who typed it.
Recorded here so the gap is explicit rather than assumed covered.

## Eligibility (advisory)

The improvement programme (proposal §5.8) stays disabled until the ledger shows at least **5 reviewed tasks**,
**2 distinct risk classes** and **at least one repair or escalation**. `npm run evidence:check` prints the
shortfall as a list; eligibility never blocks a change, it only gates the programme.

## Adding an entry

1. Run the lane: `cfkit task verify --task <id>` (the episode and diagnostic land under `.cfkit/tasks/<id>/`).
2. Hash the episode: `node -e "…"` or any sha256 tool; the revision is the exact `git rev-parse HEAD` of the run.
3. Record the hosted run URL from CI, then get a review from someone other than the author.
4. Append the entry and run `npm run evidence:check`.

## Current state

The ledger is **empty by design**: eligibility is unmet, so the machinery that consumes it (proposal §5.8) is
disabled by construction rather than by convention.
