# Clone tool: generate a new project from the kit

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-17
- Related ADRs / proposals: ADR-0002 (contract parity), ADR-0009 (cfkit CLI); `_WIP/2026-10-15_cf-core-kit-readability-proposal.md` is unaffected

## Objective

Let a new project start from this kit with one command instead of a manual clone-and-clean: `node bin/clone.mjs
<dir> [--name my-project] [--ref main] [--source <path|url>] [--dry-run]` produces a fresh repository with the
kit's value intact and the kit's project-specific records gone.

## Decision

- **Strip list as data** (`STRIP_PATHS`, `PLAN_KEEP`): `_WIP`, `.cfkit`, `coverage`, `dist`, `node_modules`,
  `docs/exec-plans/active`, and everything under `docs/exec-plans/completed` (its template and README live one
  level up). Nothing is deleted that is not on the list.
- **Fresh history**: `.git` is removed and `git init -b main` plus one initial commit records the generated
  project, so no base history, no rewritten dates, no force-push.
- **Sanitisers, not sed**: `package.json` (name, version 0.1.0, description, repository removed) and
  `wrangler.jsonc` (every `database_id` and `R2_ACCOUNT_ID` back to zeros, kit token renamed) are rewritten as
  data; the docs, README and AGENTS.md get the same token rename, and the README gains a provenance banner
  naming the source ref and revision.
- **Dry run prints the plan and writes nothing**; the tool is a standalone ESM script with no dependencies, so
  it can run from a clone or via the package `bin` entry.

## Acceptance Criteria

1. A dry run prints every strip path and the rename, and writes nothing (proved).
2. A real clone loses `_WIP`, `.cfkit`, the completed plans and the deployed ids, keeps `contracts/`,
   `docs/engineering/`, the ADRs and the harness, has exactly one commit on `main`, and carries the renamed
   package and the provenance banner (proved against a clone of `development`).
3. Sanitisers are fixture-covered: kebab names, the plan text, `package.json`, `wrangler.jsonc` (both spacings)
   and the banner (fixtures).
4. The generated project passes `npm run verify` (see the gap below).

## Gaps recorded honestly

- **The generated project's `verify` has not been proved yet.** Running it with the base's `node_modules`
  symlinked failed across storage, queue and integration specs — the symlink shares vitest/Miniflare state that
  belongs to the base path, so the run is not evidence either way. The acceptance step that remains is a clone
  followed by a real `npm install --include=dev` and `npm run verify`; until that is green, the tool is
  "generates the right tree", not "generates a verified project".
- The strip list keeps `contracts/` (the family snapshot). A project targeting a different backend re-pins it
  rather than stripping it; that remains a documented manual step.

## Verification

```bash
node --test bin/clone.test.mjs                 # 5 fixtures: names, plan text, package.json, wrangler ids both
                                               # spacings, doc rename and banner
node bin/clone.mjs /tmp/x --name demo-kit --dry-run   # prints the plan; /tmp/x is not created
node bin/clone.mjs /tmp/clone-smoke --name demo-kit --source . --ref development
  # tree: no _WIP; completed/ empty; one commit on main; 4 zeroed database ids; no real id; package renamed;
  # README starts with the provenance banner
npm run verify                                 # base kit gates stay green with the new fixtures
```
