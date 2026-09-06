# Budget Checks (task 1.10)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-10
- Related ADRs / proposals: ADR-0005 (free-tier budget/guardrails), ADR-0008 (executable rules), ADR-0011 (gate honesty; single gate); roadmap task 1.10

## Objective

The mechanically checkable free-tier guardrails become real gate checks, wired into `npm run verify`: bundle size (with the dry-run upload size parsed), crypto allowlist (`node:crypto` banned; `crypto.subtle` confined to the platform), `env` confinement (`context.env` outside the platform/composition root is a violation), KV access allowlist (the write-path wall exists before any KV binding does), and cron-trigger count (≤ 1 per project) parsed from `wrangler.jsonc`.

## Constraints

- Checks are Node ESM scripts under `scripts/budget/` (Node 22, zero dependencies), tested with `node --test` — the same pattern the frontend kit's harness uses for Node-context tooling.
- Every check is a pure function over gathered inputs (file lists, wrangler content, dry-run output) so violation fixtures can prove it fails — gate honesty per ADR-0011.
- Budget constants are explicit: bundle ≤ 2048 KiB (informational guardrail; the platform limit is 64 MiB), crons ≤ 1 (project rule; the account has 5 shared), `crypto.subtle` allowed under `src/platform/`, `context.env` allowed under `src/platform/` and `src/app.ts` (the single env handoff to config), KV allowlist currently empty by design.
- Spec files (`*.spec.ts`) are excluded from scans; the scan covers `src/**` production code.
- The eslint config learns Node globals for `.mjs` scripts (console/process).
- Wiring: `budget:check` + `test:scripts` scripts; `npm run verify` runs them between typecheck and build.
- Strict lint budgets (ADR-0011); no comments in source.

## Impact Areas

- API / contract: no
- DB / migrations: no
- Auth / session: no
- Queue / jobs: no
- Config / secrets: no
- Observability: no
- Budget / free-tier footprint: yes — this is the task
- CI / release: yes (the gate gains two steps; CI already mirrors the gate)

## Acceptance Criteria

1. `npm run budget:check` passes on the current tree and fails (exit 1) with named violations for: a `node:crypto` import, `crypto.subtle` outside the platform, `context.env` outside the allowlist, `env.KV` access outside the allowlist, >1 cron trigger, and an over-budget bundle.
2. `node --test scripts/budget/check.test.mjs` covers each check's pass and violation paths with fixtures (gate honesty).
3. A live probe run proves the real check fails on an injected violation file and passes after removal.
4. `npm run verify` runs the new checks; everything green; roadmap 1.10 checked; plan filed to `completed/`.

## Steps

- [x] `scripts/budget/check.mjs` (five checks + runner + constants)
- [x] `scripts/budget/check.test.mjs` (node:test fixtures)
- [x] Wire `budget:check` / `test:scripts` into verify; eslint Node globals for `.mjs`; AGENTS.md verify line
- [x] Live probe evidence + verify + roadmap/bookkeeping

## Decision Log

- 2026-10-10: checks live as Node scripts, not vitest — they read the filesystem and spawn wrangler. -> workers-runtime tests cannot; node:test is the family pattern for scripts
- 2026-10-10: bundle budget 2048 KiB (upload size parsed from the dry-run). -> guardrail against dependency bloat, not the platform limit
- 2026-10-10: `context.env` allowlist is `src/platform/**` + `src/app.ts`. -> composition root hands env to config exactly once
- 2026-10-10: KV allowlist is empty until a maintenance path exists. -> the wall precedes the binding
- 2026-10-10: cron limit 1 per project. -> account shares five; fan-out style stays the design

## Verification

Exact commands and outcomes:

```bash
npm run verify
# format:check ✓, lint ✓, typecheck ✓
# tests: 146 passed across 26 files (vitest) + 6 node:test script fixtures
# budget: scanned 38 production sources; bundle 834.51 KiB / 2048 KiB; all checks passed
# build: wrangler dry-run — 834.51 KiB / gzip 136.44 KiB

# Live probe (gate honesty): injected src/features/__budget_probe.ts with node:crypto +
# context.env + env.KV → exit 1 with all three violations; removed → clean pass
```

## Completion Notes

Budget checks landed as Node scripts (`scripts/budget/check.mjs` + node:test fixtures): bundle size parsed from the wrangler dry-run (2048 KiB guardrail), crypto allowlist (`node:crypto` banned anywhere; `crypto.subtle` confined to `src/platform/`), `context.env` confinement (`src/platform/**` + `src/app.ts`), KV access allowlist (empty until a maintenance path exists), and the cron-trigger budget (1/project) with JSONC parsing. `npm run verify` now runs `test:scripts` + `budget:check`; eslint learned Node globals for `.mjs`; Vitest includes only `src/**/*.spec.ts` so the Node fixtures stay out of the Workers runtime. The live probe failed with all three injected violations and passed after removal (gate honesty, ADR-0011). 6 new fixtures; verify green.

## Follow-ups

- [ ] Budget constants land in `docs/standards/free-tier-budget.md` when the standard is drafted
- [ ] cfkit v0 (1.11) wraps `budget:check` behind the CLI; drift checks join 1.12
- [ ] Re-verify checks once KV/R2/Queues modules land (allowlist entries earn their place)
