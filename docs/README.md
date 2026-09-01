# CF Core Kit — Documentation

cf-core-kit is the Cloudflare member of the core-kit family: a standalone Workers backend template that serves the same wire contract as `backend-core-kit` for the implemented surface (password operations descoped — see ADR-0006), engineered to run inside Workers Free plan budgets.

These docs are the source of truth for architecture, standards, and workflow; code follows the docs.

## Navigation

- Core
  - `docs/core/project-architecture.md`
  - `docs/core/project-stack.md`
- Standards (normative)
  - `docs/standards/README.md` — index; free-tier-budget lands first, with platform core
- ADRs (decision log)
  - `docs/adr/README.md`
- Execution plans
  - `docs/exec-plans/README.md`
  - `docs/exec-plans/roadmap.md` — high-level phases and task tracking
- Contract
  - `docs/openapi/openapi.yaml` — generated snapshot (lands with the contract pipeline)
  - `tools/parity/coverage.json` — parity manifest: implemented / pending / descoped operations
- Proposals (historical, not source of truth)
  - `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`

## Doc Conventions

- "Standards" are normative. Deviating requires an ADR and a documented exception.
- The wire contract is owned by `backend-core-kit`. This kit follows it; it never invents or changes contract surface (ADR-0002).
- Keep docs implementation-aware (file paths, config keys, behaviors) without code dumps.
