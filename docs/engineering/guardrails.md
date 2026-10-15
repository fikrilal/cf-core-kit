# Guardrails: which gate owns which rule

The map, not a second rulebook: every rule has exactly one home, and a rule written in prose but enforced
nowhere is a bug report against this table. `AGENTS.md` points here; the standards hold the normative detail.

| Home                                                        | Owns                                                                                                                                                                       | Fails on              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `eslint.config.mjs` (zones)                                 | dependency direction: platform ↛ features, features ↛ app entry, `src/shared` framework-free, per-pair feature imports, no cycles                                          | `npm run lint`        |
| `scripts/budget/check.mjs`                                  | free-tier footprint: bundle size, crypto allowlist, env confinement, KV writes, cron count, queue concurrency, storage                                                     | `budget:check`        |
| `scripts/security/secrets-scan.mjs`                         | secret material and provider-key shapes in tracked files (allowlists carry reasons)                                                                                        | `secrets:check`       |
| `scripts/drift/check.mjs`                                   | generated-artifact drift: wrangler types, Drizzle migrations, the docs link graph, the project map, the ADR index                                                          | `drift:check`         |
| `scripts/contract/{check,lint}.mjs`                         | the pinned contract: provenance, emit drift, parity manifest, the Spectral ruleset                                                                                         | `contract:check`      |
| `scripts/config/check.mjs`                                  | `wrangler.jsonc` vars versus the config schema versus the documented secrets                                                                                               | `config:check`        |
| `scripts/smells/check.mjs`                                  | rule-level architecture traps (uncomposed job modules, wall-clock in features, raw error-code literals, console outside the logger, TODO markers) with a reviewed baseline | `smells:check`        |
| `scripts/duplication/check.mjs`                             | clones: the fatal 60-token core profile and the report-only 24-token small-helper profile                                                                                  | `duplication:check`   |
| `tools/cfkit/plans.ts`                                      | the exec-plan contract: status ↔ folder, slug task ids, required sections, checkbox scoping, the metadata block                                                            | `plans:check`         |
| `tools/cfkit/oracles.ts`                                    | end-to-end evidence for the high-risk behaviours; a single-feature spec is structurally ineligible                                                                         | `oracles:check`       |
| `tools/cfkit/evidence.ts`                                   | the operating-evidence ledger: hash/branch/workspace bindings, no free text, eligibility shortfall                                                                         | `evidence:check`      |
| `tools/cfkit/{task,preflight,workspace,handoff}.ts`         | the task machine: legal transitions, authority and scope bindings, budgets, approval bindings                                                                              | `task …`, `handoff …` |
| `scripts/gates/check.mjs`                                   | **gate honesty**: every gate above is shown to bite by a planted violation, restored byte-identically                                                                      | `verify:gates`        |
| `scripts/tests/tiers.test.mjs`                              | the test map: every spec file belongs to a tier, the coverage reporters and floors are pinned                                                                              | `test:scripts`        |
| `.github/workflows/ci.yml` + `scripts/ci/workflow.test.mjs` | the lanes, the pins, least privilege, and that no lane inlines a profile's internals                                                                                       | `ci`                  |

## The escalation ladder

**Same failure twice ⇒ automate it.** The first time is a mistake; the second is a missing check. The ladder:

1. **Fix it** and record the finding in the plan (implementation notes, not prose).
2. **Fixture it** — the smallest test that fails if it comes back.
3. **Gate it** — if a human has to remember it, it belongs in a gate above, with a fixture proving both
   directions and a `verify:gates` probe proving the gate itself can fail.
4. **Document the home** — add the row to this table, so the next person finds the rule where it lives.

## Suppression policy

A suppression is a promise that someone reviewed the exception. Therefore: allowlist entries carry a reason;
smell baselines require `SMELLS_BASELINE_APPROVED=true` and a review date; eslint exceptions are per-rule and
per-path (never a file-wide disable); `--force` on scaffold/remove is for a decision, not for a hurry; and
`--no-verify` is not in the vocabulary — the handoff's refusal set forbids it by name. When a gate is wrong,
fix the gate: a rule that forbids what the template requires is a bug in the rule, and this repository has
rewritten its own contract once for exactly that reason.
