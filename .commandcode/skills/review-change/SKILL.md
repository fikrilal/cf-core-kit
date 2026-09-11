---
name: review-change
description: Exhaustive, evidence-backed change review for the cf-core-kit repository — reconstructs before/after Worker behavior, then audits the wire contract and parity manifest, free-tier budget rules, platform boundaries and env confinement, D1/idempotency correctness, Workers-runtime constraints, TypeScript strictness, tests and gate honesty, and docs/process against AGENTS.md standards, reporting findings by severity. Use when asked to review a commit, range, PR, or diff, find bugs or flaws in a change, or perform a code review.
argument-hint: "<commit / range / PR / diff> [base]"
---

# Comprehensive Change Review — cf-core-kit

Target change: $ARGUMENTS — if empty, use the change under discussion in the conversation; if ambiguous, ask which boundary to review first.
Base: the target's parent unless the invocation explicitly gives a base.

You are an exacting senior reviewer for the cf-core-kit repository — a standalone Cloudflare Workers backend kit that serves the backend-core-kit wire contract for the implemented surface and is engineered to live inside Workers Free plan budgets.

Do not modify, stage, commit, or revert anything. Read-only review.

## Phase 0 — Ground truth

- `git show --stat` and read the full diff, then every changed file in its calling context.
- State the claimed intent (commit message, matching exec plan under `docs/exec-plans/`, roadmap task) and the exact review boundary.
- Read `AGENTS.md`, `docs/README.md`, and the topic docs the change touches: `docs/core/project-architecture.md`, `docs/core/project-stack.md`, `docs/standards/`, the ADR whose baseline moves, `contracts/README.md` + `tools/parity/README.md` for contract work, `docs/exec-plans/roadmap.md` for scope.
- Classify risk:
  - **High** — wire-contract surface (routes, envelope/problem shapes, error codes, emitted OpenAPI, parity manifest), auth/session/token semantics, D1 schema/migrations/idempotency, free-tier budget behavior (KV, crons, subrequests, rows written, bundle size, crypto), platform boundaries or `env` confinement, CI/harness checks (cfkit, verify profiles, budget/drift/contract scripts).
  - **Medium** — other `src/platform/**` code, tests, scripts/tooling, wrangler config.
  - **Low** — docs and narrow repository metadata.
- Medium/high risk requires runtime or probe evidence, not static confidence. Never accept "refactor" as behavior-preserving without proof (byte-compare generated artifacts; before/after responses from the Workers pool or a local dev server).

## Phase 1 — Behavior reconstruction

- Map the changed path through the Worker lifecycle: the `fetch` pipeline order (request-id → request logging → auth → validation → handler → envelope/problem), the queue consumer, the scheduled/cron handler, DO alarms — whichever the change touches.
- Trace one concrete path per changed behavior: route → validation (`decode` / `readJson`) → service/usecase → D1 (`batch` atomicity) / cache / queue → envelope, problem, or 204.
- List silent behavior changes: status codes (including the 201→200 idempotent replay downgrade), problem `title`/`code`/`traceId`, headers (`X-Request-Id`, `Idempotency-Replayed`, `Retry-After`, `Location`, cache/CDN headers), list `meta` (`limit`, `hasMore`, `nextCursor`), rows written per request, subrequest count, CPU added per request (zod parsing, JSON, crypto), and log-line changes.

## Phase 2 — Review dimensions (report only evidence-backed issues)

1. **Correctness & Workers runtime** — no Node-only APIs or `node:*` imports in `src/**` (WebCrypto, fetch, D1 only); module-level state is per-isolate, never cross-request durable; time never comes from `new Date()`/`Date.now()` in service/domain code — it comes from the injected `Clock`; background work uses `waitUntil`; CPU stays inside the 10 ms free-tier envelope (flag added zod/JSON work per request that plausibly breaks it); local-dev vs deployed differences are not papered over.
2. **Architecture & boundaries** — `src/platform/*` never imports `src/features/*`; features never import `src/worker.ts` or app-entry modules; cross-feature imports only through exported surfaces (allowlisted, acyclic); `src/shared/*` stays framework-free; raw `env`/binding access only inside `src/platform/**` (and the single handoff in `src/app.ts`); no speculative abstractions — new helpers/usecases must have a real consumer.
3. **Wire contract & parity (owned by backend-core-kit)** — envelope `{ data, meta? }`, lists `{ nextCursor?, limit, hasMore }`; RFC7807 `application/problem+json` with stable `code`, `traceId` (= `X-Request-Id`), optional `errors[]`; `X-Request-Id` echoed on every response; error codes from the typed union, never raw strings; 204 empty semantics; dotted operationIds; every operation declares `x-error-codes`; the emitted snapshot regenerates cleanly (`npm run contract:emit` leaves the tree byte-identical) and the parity manifest moves operations `pending → implemented` in the same change that ships the route; no invented contract surface; descoped operations are never mounted as stubs.
4. **Free-tier budget rules (ADR-0005/0008)** — KV writes only through allowlisted maintenance paths (never per request); cron triggers stay ≤ 1 per project; ≤ 2–3 rows written per API write request (index amplification included); subrequests by design ≤ 10; bundle size under the guardrail (budget check reports it); crypto allowlist (no `node:crypto`; `crypto.subtle` confined to `src/platform/`); DO usage hibernating; CDN/cache headers deliberate.
5. **TypeScript strictness** — no `any`, `as`, non-null `!`, or assertions that silence the compiler; `unknown` + narrowing at boundaries; `readonly` where the codebase uses it; `tools/contract` and `tools/cfkit` stay erasable-syntax-only (run by Node type stripping); no `console` outside the logging module.
6. **Security** — secrets never in git (`.dev.vars` local, `wrangler secret` deployed); new logged fields respect the redaction deny list; fail-closed auth defaults; D1 access parameterized (Drizzle only); presigned URLs scoped and expiring; token comparisons constant-time where tokens exist.
7. **Data & persistence** — migrations generated by drizzle-kit and drift-checked (hand-edited SQL/journal is a finding); expand → migrate → contract for anything destructive; multi-statement atomicity via `batch()`, never interactive transactions; index discipline (an index costs writes); idempotency records keep the acquire/replay/release state machine.
8. **Testing & gate honesty (ADR-0011)** — every new check or gate ships with a fixture or live probe that fails on injected violation, and the probe must actually reach the failure path (assert the rule name/exit code, not just "an error"); unit specs stay colocated in `src/**/*.spec.ts`; dialect work extends `test/contract/`; Node-context fixtures avoid the Vitest include and are wired into `test:scripts` (an unwired fixture file silently never runs); tests actually run in this review, not just in the PR description.
9. **Ops & observability** — exactly one log line per request (the request-logging skip list respected); expected `AppError`s at warn with `code`, unknown errors at error with stack; `traceId` propagates to logs; no PII beyond the deny list.
10. **Docs & process** — exec plan updated (active → completed with evidence and honest skip notes); roadmap checkbox and Current Focus moved; ADR when a baseline or decision changes; `AGENTS.md` map and `docs/README.md` updated when structure moves; Conventional Commits; nothing pushed/committed that the user did not ask for; deployment claims only from the credentialed lane — a temporary preview deploy is not a production deploy claim.

## Phase 3 — Verification honesty

Run the checks the change warrants:

```bash
npm run verify            # fast profile: format, lint, typecheck, typecheck:cfkit, vitest, script fixtures, budget, drift, contract:check, contract:lint
npm run verify:ci         # full profile: the above + dry-run build — CI parity
npm run cfkit -- doctor   # environment/readiness when the change touches tooling or config
npm run budget:check      # when the change can move bundle size, KV writes, crons, or crypto
npm run drift:check       # when config, docs, migrations, or generated types move
npm run contract:check    # when routes, schemas, or the parity manifest move
npm run contract:emit     # must leave docs/openapi/openapi.yaml byte-identical when routes are declared unchanged
npm run test:scripts      # node:test fixtures for scripts/tools changes
```

- For new or changed gates, run the violation probe yourself (inject the drift, observe the failure, restore).
- Separate checks you ran from checks merely claimed. Call out skipped checks and residual risk. Never report a passing check you did not run.

## Output format

1. **Findings first**, severity-ordered: Critical / High / Medium / Low / Nit. Each: `file:line`, what breaks with a concrete scenario, why it matters, minimal fix.
2. **What changed and how it works** — compact execution-path trace.
3. **Verified vs claimed** — exact commands and outcomes.
4. **Residual risk & uncertainty** — what was not reviewed; confirmed vs suspected; deployment-lane caveats.

Rules: every claim grounded in read code; no invented line numbers; no completeness theater — only concerns supported by the change.
