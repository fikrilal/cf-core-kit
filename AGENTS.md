# Repository Guidelines

## Operating Contract

- Keep changes small, focused, and reversible.
- Simplicity first: the minimum code that solves the problem. No speculative abstractions or flexibility that was not requested. If 200 lines could be 50, rewrite it.
- Prefer the existing architecture, helpers, scripts, and standards over new patterns.
- If behavior, architecture, standards, or public contracts change, update the relevant docs and add an ADR when a decision changes a baseline.
- Do not commit or push unless the user explicitly asks. Use Conventional Commits when committing.
- The wire contract is owned by backend-core-kit. This kit follows it; it never invents or changes contract surface. Password operations are deliberately descoped for v1 (ADR-0006) and tracked in the parity manifest.
- Optimize for the Workers Free plan: treat `docs/standards/` budget rules as architecture, not advice.

## Source of Truth

Start with `docs/README.md`, then follow the topic-specific source:

- Architecture: `docs/core/project-architecture.md`
- Stack: `docs/core/project-stack.md`
- Standards (normative): `docs/standards/README.md`
- ADRs: `docs/adr/README.md`
- Execution plans: `docs/exec-plans/README.md`
- Contract: `docs/openapi/openapi.yaml` + `tools/parity/coverage.json` (land with the contract pipeline)
- Proposals (historical, not source of truth): `_WIP/`

## Hard Rules

- Successful JSON responses use the envelope `{ data, meta? }`; lists return `data` plus `{ nextCursor?, limit, hasMore }` meta.
- Errors are RFC7807 problem details with a stable `code`, `traceId` (= `X-Request-Id`), and optional `errors[]`.
- `X-Request-Id` is accepted and echoed on every response. Retryable writes honor `Idempotency-Key` and set `Idempotency-Replayed: true` on replay.
- Error codes are typed constants; raw production error-code strings are rejected by construction.
- Features must not construct raw data responses — use platform helpers.
- Raw `env` / binding access is allowed only inside `src/platform/config` and platform modules; features receive typed ports.
- KV writes are allowed only in allowlisted maintenance paths — never per request.
- Crypto allowlist: Ed25519/ES256 sign+verify; RS256 verification for OIDC ID tokens; no RSA signing.
- No `new Date()` / `Date.now()` in service/domain code — time comes from the injected `Clock`.
- No password material is stored anywhere; `auth.password.*` is descoped (ADR-0006).
- Budget rules are hard rules: ≤ 2–3 rows written per API write request, ≤ 10 subrequests per request by design, one cron trigger per project.
- Secrets never go in git. Use `.dev.vars` locally and `wrangler secret` for deployed environments.
- Contract gates: implemented operations ⊆ pinned snapshot and declared in `tools/parity/coverage.json`; generated artifacts are regenerated, committed, and drift-checked.

## Architecture Map

```text
src/worker.ts       fetch / queue / scheduled handlers + DO class exports
src/app.ts          composition root (middleware + feature mounting)
src/platform/       cross-cutting: config, http, auth, db, cache, queue, storage, ...
src/features/       vertical slices (progressive tiers)
src/shared/         framework-free cross-feature contracts and utilities
test/               integration and contract suites
tools/cfkit/        scaffold / remove / verify / budget / contract CLI (M1)
tools/parity/       parity manifest + checker scripts
docs/               standards, ADRs, exec plans
_WIP/               proposals (historical)
```

Dependency direction:

- `src/platform/*` must not import `src/features/*`.
- `src/features/*` must not import `src/worker.ts` or app entry modules.
- Cross-feature imports only through a feature's exported surface, allowlisted per pair, acyclic.
- `src/shared/*` stays framework-free (no Workers-specific APIs).

## Verification

Use the repo scripts; do not claim a check passed unless it was actually run.

- `npm run verify` — delegates to `cfkit verify --profile fast` (format, lint, typecheck, vitest, script fixtures, budget checks). CI runs `npm run verify:ci` (the full profile, adds the dry-run build).
- `npm run cfkit -- doctor` / `budget:check` / `verify --profile fast|full`. (`contract:check`, `scaffold`/`remove feature`, and `runtime`/`ci` profiles land in later phases.)
- Record exact verification commands and outcomes for auth/session, queue, idempotency, contract-surface, and budget-relevant changes; include measured CPU / rows-written where a change affects them.

## Delivery Notes

- Summarize changed files, behavioral impact, and verification evidence.
- Call out skipped checks and why.
- Call out residual risk, especially for auth, contract surface, idempotency, budget, and CI.
- Leave unrelated dirty worktree changes untouched.
- Leave completed work uncommitted by default; wait for an explicit user request before creating commits.
