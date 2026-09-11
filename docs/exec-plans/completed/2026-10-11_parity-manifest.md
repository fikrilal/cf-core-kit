# Parity manifest and coverage check (task 2.3)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0002 (mechanism 2: manifest + CI failure on drift; mechanism 3: descope recorded, not stubbed), ADR-0006 (password descope); roadmap task 2.3

## Objective

`tools/parity/coverage.json` classifies every operation in the pinned backend snapshot into exactly one bucket — `implemented`, `pending`, `descoped` — and `contract:check` enforces: full, non-overlapping classification; `implemented` operations exist in our emitted spec with matching shape (path, method, operationId, tags, `x-error-codes`, response statuses, response schemas compared after same-document `$ref` resolution); `descoped` entries carry the ADR reference and revisit note. The manifest source block mirrors `contracts/provenance.json`.

## Constraints

- Manifest shape follows the proposal sketch (§5.3): source block (repo, path, commit, sha256), explicit `implemented` and `pending` operation-id lists, `descoped` as objects `{ operations, reason, revisit, adr }`. Wildcards (`auth.password.*`) are allowed only in `descoped`.
- Classification is complete and disjoint over the snapshot's 34 operations: 2 implemented (`health.get`, `ready.get`), the password operations descoped with ADR-0006 (exact count verified during implementation from the snapshot), the remainder pending and listed explicitly — auditable, no silent defaults.
- Shape comparison resolves `$ref` inside each document before comparing sub-trees, so inline (ours) vs referenced (backend feature ops, later) schemas compare correctly; key order is normalized (deep-equal over parsed JSON), unknown extra fields in our emitted op are a failure only for the checked fields.
- Checker implementation stays in `scripts/contract/check.mjs` (fixture-tested with `node:test`); `tools/parity/` holds the manifest data. AGENTS.md map drops the `(planned)` marker for `tools/parity/`; docs/README contract section updated.
- Gate honesty: reclassifying an implemented op to pending fails; a shape drift between the emitted spec and the snapshot fails; an unclassified snapshot op fails; a descoped entry without ADR fails (fixtures + live probes).

## Impact Areas

- API / contract: yes (the inventory becomes machine-checked)
- CI / release: yes (`contract:check` grows; no new step)
- Docs: yes (AGENTS map, docs/README, contracts/README cross-reference)

## Acceptance Criteria

1. `tools/parity/coverage.json` classifies all 34 snapshot operations exactly once; `npm run contract:check` passes on the current surface.
2. Live probes fail as expected: `health.get` moved to `pending`; emitted health schema mutated; a snapshot op removed from all buckets; `descoped` entry stripped of its ADR reference (each restored afterwards).
3. Fixtures cover the pure parts: classification completeness/disjointness, wildcard matching, `$ref`-aware deep compare, descope metadata requirements.
4. `npm run verify` green; roadmap 2.3 checked; plan filed to `completed/`.

## Steps

- [x] Build the manifest from the snapshot (script-assisted inventory, hand-reviewed)
- [x] Parity check in `scripts/contract/check.mjs` + fixtures (classification, wildcards, shape compare)
- [x] Live probes; AGENTS map + docs/README updates; verify + bookkeeping

## Decision Log

- 2026-10-11: `pending` is an explicit list, not a wildcard. -> the manifest states exactly what remains; drift in upstream operations surfaces immediately
- 2026-10-11: shape comparison is field-scoped (identity + tags + error codes + responses) with `$ref` resolution, not whole-operation equality. -> descriptions/summaries may be reworded upstream without failing parity, while client-visible facts are locked

## Verification

Exact commands and outcomes:

```bash
npm run test:scripts   # 45 fixtures (11 parity fixtures)
node scripts/contract/check.mjs   # "parity: ok" (exit 0)
# probe 1: health.get moved to pending -> exit 1, "emitted operation is not declared implemented: health.get"
# probe 2: descoped entry stripped of adr -> exit 1, "descoped entry is missing adr"
# probe 3: auth.jwks.get removed from pending -> exit 1, "operation not classified: auth.jwks.get"
# each probe restored; final run exit 0
# (response-schema and error-code shape drift are fixture-level probes:
#  $ref-resolved equality, schema drift, error-code drift)
```

## Completion Notes

`tools/parity/coverage.json` classifies all 34 snapshot operations: 2 implemented (health.get, ready.get), 27 pending (explicit list), `auth.password.*` (5 operations) descoped with reason, revisit note, and the ADR-0006 reference. The contract check grew a parity section: complete/disjoint classification with wildcard support, stale-pattern detection, descope metadata requirements, manifest↔provenance hash agreement, emitted-spec ⊆ implemented (both directions), and field-scoped shape parity (operationId, tags, parameters, x-error-codes, response statuses, response content with same-document `$ref` resolution and stable key ordering). `tools/parity/README.md` documents the bucket semantics; AGENTS map and docs/README updated. Live probes: reclassification, descope metadata, and unclassified-operation cases all exit 1 with named violations and restore clean.

## Follow-ups

- [ ] Each later phase moves operations from `pending` to `implemented` in the same PR that ships the route
