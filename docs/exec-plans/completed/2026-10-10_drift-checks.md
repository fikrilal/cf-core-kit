# Drift & docs checks (task 1.12)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-10
- Related ADRs / proposals: ADR-0008 (drift checks as executable rules), ADR-0011 (gate honesty); roadmap task 1.12

## Objective

The four roadmap drift checks become gate steps: project map (AGENTS.md architecture tree ↔ real directories, bidirectional), markdown link integrity across tracked docs, `wrangler types` drift (via the built-in `wrangler types --check`), and Drizzle migrations drift (schema changes without a regenerated migration). ADR index completeness rides with the docs checks: every `docs/adr/NNNN-*.md` is indexed and every index link resolves.

## Constraints

- `scripts/drift/check.mjs` + `node:test` fixtures — same pattern as `scripts/budget/`.
- Types drift uses `wrangler types --check` (built in, non-mutating); migrations drift copies `db/migrations` to a temp dir and runs `drizzle-kit generate --out <tmp> --name drift_probe`, so the repository tree is never touched; a change that would generate a new migration is a violation naming the new file.
- Map check is bidirectional: every map entry path exists on disk unless the line is marked `(planned)`; every top-level directory (and every immediate `src/` child) is mentioned by a map entry. The map is corrected as part of this task (`db/migrations/`, `scripts/budget/`, `scripts/drift/` added; `src/features/` and `tools/parity/` marked planned until their phases land).
- Link check scans tracked markdown (repo walk excluding node_modules/dist/.git/coverage), resolves relative targets, skips `http(s)`, `mailto:` and pure anchors, strips fragments. Docs found broken get fixed as part of the task.
- ADR files match `^\d{4}-`; `template.md` is exempt; both directions enforced through `docs/adr/README.md`.
- Wiring: `drift:check` npm script joins `test:scripts` (fixtures) and the cfkit fast profile; the cfkit fixture's expected fast-step list is updated.
- Live gate-honesty probes for the two generative checks (mutate `worker-configuration.d.ts` / `schema.ts`, expect failure, restore); fixture-level probes for map, links, and ADR index.

## Impact Areas

- API / contract: no
- DB / migrations: no (probe only; nothing generated in-tree)
- Auth / session: no
- Queue / jobs: no
- Config / secrets: no
- Observability: no
- Budget / free-tier footprint: no (dev-time only)
- CI / release: yes (fast + full profiles gain `drift:check`; CI inherits via `verify:ci`)
- Docs: yes (map corrected; any broken links fixed)

## Acceptance Criteria

1. `npm run drift:check` passes on the corrected tree and fails with named violations for: a mutated `worker-configuration.d.ts`, a schema change without migration, an unmapped top-level dir, a map entry that does not exist (without `(planned)`), a broken markdown link, and an unindexed/undangling ADR.
2. Fixtures cover each check's pass and violation paths (gate honesty at the unit level); live probes for the types + migrations checks.
3. `npm run verify` (fast profile) includes `drift:check`; everything green; roadmap 1.12 checked; plan filed to `completed/`.

## Steps

- [x] Spike `wrangler types --check` and the drizzle temp-out probe manually
- [x] `scripts/drift/check.mjs` (four checks + runner) + `check.test.mjs`
- [x] Correct AGENTS.md map; fix any broken links the check surfaces; wire `drift:check` into test:scripts, cfkit fast profile, AGENTS.md verify bullet
- [x] Live probes (types, migrations) + full verify + bookkeeping

## Decision Log

- 2026-10-10: types drift regenerates to a temp path and byte-compares after normalizing two volatile artifacts (the invocation/hash header line and the main-module import path relative to the output location). -> `wrangler types --check` empirically passed a comment-only edit while rejecting an empty file, so it is too weak; regeneration is deterministic once those two artifacts are normalized
- 2026-10-10: the `(planned)` marker is honored in the map check (existence skipped), and every real directory must still be mentioned. -> documented pillars stay honest without lying about disk
- 2026-10-10: migrations drift probes a temp copy via `--out`, never the tree. -> generate is non-interactive with `--name`; failure evidence is the would-be migration name
- 2026-10-10: map entries may be marked `(planned)`; reverse direction requires a mention for every real directory. -> planned pillars stay documented without lying about disk; drift (new dirs) still fails
- 2026-10-10: link check is path-resolution only (no anchors). -> heading slugs would reimplement a markdown parser for marginal value

## Verification

Exact commands and outcomes:

```bash
npm run verify
# [cfkit] verify --profile fast: 8/8 steps green (format:check, lint, typecheck,
#   typecheck:cfkit, test 146, test:scripts 24 fixtures, budget:check, drift:check 2.9s)
# [drift] markdown files: 35; types: up to date; migrations: no pending generation

npm run verify:ci
# full profile: fast steps + build (dry-run 834.51 KiB / gzip 136.44 KiB) -> profile full passed

node scripts/drift/check.mjs    # clean tree: all checks passed (exit 0)
# probe 1: appended a comment to worker-configuration.d.ts -> types: out of date, exit 1 (restored)
# probe 2: added a table to src/platform/db/schema.ts -> migrations: 0001_drift_probe.sql
#   would be generated, exit 1 (restored); clean re-run exit 0

# En route corrections: `wrangler types --check` proven too weak (passed a comment-only
# edit, rejected an empty file) -> temp regeneration + normalization of the volatile
# header line and main-module import path; AGENTS.md map truthed (db/, scripts/ added;
# src/features/ and tools/parity/ marked planned); zero broken links, ADR index complete
```

## Completion Notes

`scripts/drift/check.mjs` landed with the four checks plus docs integrity: project map (bidirectional; `(planned)` markers honored; AGENTS.md map truthed), markdown links across 35 files (zero broken at landing, so no doc fixes needed), ADR index completeness (11 ADRs aligned, template exempt), types drift (temp regeneration with normalization of exactly two volatile artifacts — the invocation/hash header line and the location-relative main-module import path), and migrations drift (temp-copy probe via `drizzle-kit generate --out` with explicit dialect/schema/out because drizzle rejects mixing config with flags). Wired into `test:scripts` (10 new fixtures, 24 total) and the cfkit fast profile; AGENTS.md verify bullet updated. Lint surfaced a `no-useless-assignment` in the link decoder, fixed with a `safeDecode` helper. Live probes: comment-only types edit failed (exit 1), unmigrated schema change failed naming `0001_drift_probe.sql` (exit 1), both restored, clean runs green; fast and full profiles verified live.

## Follow-ups

- [ ] Phase 2 re-adds `tools/parity/` to the map when the directory lands (drop its `(planned)` marker)
- [ ] `contract:check` (2.x) owns snapshot/emitted-docs drift; this script stays contract-free
