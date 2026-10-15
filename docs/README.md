# CF Core Kit — Documentation

cf-core-kit is the Cloudflare member of the core-kit family: a standalone Workers backend template that serves the same wire contract as `backend-core-kit` for the implemented surface (password operations descoped — see ADR-0006), engineered to run inside Workers Free plan budgets.

These docs are the source of truth for architecture, standards, and workflow; code follows the docs.

## Navigation

- Core
  - `docs/core/project-architecture.md`
  - `docs/core/project-stack.md`
- Standards (normative)
  - `docs/standards/README.md` — index with the status vocabulary (normative / guide / family)
  - `free-tier-budget` · `queues-jobs` · `observability` · `testing-strategy` · `database` · `ci-cd`
- Guides (task-oriented)
  - `docs/guide/README.md` — feature, endpoint, config, and jobs walkthroughs that mirror the
    scaffolding and verification tooling
- ADRs (decision log)
  - `docs/adr/README.md`
- Execution plans
  - `docs/exec-plans/README.md`
  - `docs/exec-plans/roadmap.md` — high-level phases and task tracking
- Engineering (harness contracts)
  - `docs/engineering/README.md` — the index: the harness documents, the workflow documents and the feature notes
  - `docs/engineering/cfkit.md` — every command, flag, exit code and delegation
  - `docs/engineering/guardrails.md` — which gate owns which rule, the escalation ladder, the suppression policy
  - `docs/engineering/runtime-evidence.md` — the artifacts a runtime change owes, and the redaction table
  - `docs/engineering/duplication-harness.md` — both jscpd profiles, categories and the `--fatal-found` policy
  - `docs/engineering/operating-evidence.md` — what the ledger records, and what it may never contain
    (`docs/engineering/operating-evidence-ledger.json`, checked by `npm run evidence:check`)
- Contract
  - `contracts/backend.openapi.yaml` + `contracts/provenance.json` — the pinned backend snapshot (repo, commits, SHA-256)
  - `docs/openapi/openapi.yaml` — emitted from route definitions (`npm run contract:emit`); drift-, parity-, and lint-gated
  - `tools/parity/coverage.json` — parity manifest: implemented / pending / descoped operations
  - `npm run contract:check` / `contract:lint` — provenance + emit drift + parity / family Spectral rules
- Harness
  - `npm run verify` — the fast developer profile; `npm run verify:ci` — the ci profile (fast
    steps + coverage floors + duplication gate + dry-run build + runtime boot smoke + scaffold
    smoke), which is what CI runs
  - `npm run cfkit -- …` — verify profiles, `doctor`, `scaffold`/`remove`, `task`, `handoff`,
    plus the `budget:check` / `secrets:check` / `contract:check` delegates
- Proposals (drafts and historical records, not source of truth)
  - `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md` — v1 architecture (accepted; decisions promoted to ADRs)
  - `_WIP/2026-10-12_harness-parity-proposal.md` — 1:1 harness parity with `backend-core-kit` (draft; §7 carries the high-level roadmap)

## Doc Conventions

- "Standards" are normative. Deviating requires an ADR and a documented exception.
- The wire contract is owned by `backend-core-kit`. This kit follows it; it never invents or changes contract surface (ADR-0002).
- Keep docs implementation-aware (file paths, config keys, behaviors) without code dumps.
