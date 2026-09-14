# Roadmap

- Status: living document — update as phases and tasks land
- Updated: 2026-10-11
- Scope: high-level phases, task tracking, and exit gates. Details live in per-task execution plans.

## How To Use

- This roadmap is the index; it never replaces an execution plan.
- Every task gets a plan from `_template.md` stored in `docs/exec-plans/active/` before work starts; completed plans move to `docs/exec-plans/completed/` with verification evidence.
- Update checkboxes and "Current Focus" as tasks complete. A task is done only when its gate actually ran.
- `npm run verify` delegates to `cfkit verify --profile fast` (CI runs `verify:ci`, the full profile) — the standing gate for every task; phases add gates (budget checks, drift checks, contract suite).
- Decisions that change a baseline require an ADR first (see `docs/adr/README.md`).

## Harness

The harness keeps quality golden; it is mandatory, not optional. Layers, in landing order (practices ported from backendkit, frontendkit, mobilekit, and gokit):

1. **Strict lint/format baseline** (landed, 1.0): type-aware eslint (`strictTypeChecked` + `stylisticTypeChecked`), import hygiene (`import-x`: first, newline-after-import, no-cycle, no-duplicates, no-mutable-exports), budgets (complexity 12, max-lines 350, max-lines-per-function 80), `no-console`, `eqeqeq`, Prettier. Violation probes confirmed the gates fail with their expected markers.
2. **Budget checks** (landed, 1.10): the free-tier guardrails are real checks (ADR-0005, ADR-0008) — bundle size, crypto allowlist, `env` confinement, KV-write allowlist, cron count — wired into the verify gate.
3. **cfkit v0** (landed, 1.11): typed command layer, `verify --profile fast|full`, `doctor`, `budget:check`; `npm run verify` delegates to the fast profile; CI calls the same profile.
4. **Drift & docs checks** (landed, 1.12): project map (AGENTS.md tree ↔ dirs), markdown link integrity, `wrangler types` + drizzle migrations drift, ADR index completeness.
5. **Contract gates** (landed, 2.1–2.5): snapshot pin + provenance, emitted OpenAPI + drift gate, parity manifest check, Spectral family rules, and the contract suite — each gate carrying a gate-honesty meta-test.
6. **Feature-level enforcement** (in progress, 3.x–5.x): `env` confinement and the crypto allowlist already gate through budget checks (1.10); boundary lint rules land with 3.5 (platform ↛ features, shared purity, cross-feature surfaces); scaffold output smoke-tested against `npm run verify` and `remove feature` unwiring land with Phase 5; duplication policy and runtime evidence later.

Rules: findings gate on **new vs baseline**, and baseline updates require explicit approval (never silent). Profiles are defined once (fast/full/runtime/ci), fail-fast with stable step ids and advisory duration budgets. A gate that cannot fail is not a gate — every new gate ships with a violation probe or a meta-test.

## Current Focus

**Phase 3 — Auth slice** (in progress): 3.1–3.3 landed (schema, OIDC sign-in, session rotation/reuse detection/logout — all contract-green); next: 3.4 (JWKS endpoint + keyring rotation), then 3.5 (DO auth rate limiting + boundary lint zones), 3.6–3.8.

## Phase 0 — Foundation (complete, 2026-10-10)

- [x] Toolchain: Node 22.22.0 (`.nvmrc`), npm, wrangler 4.149.0
- [x] Scaffold: npm scripts with the single `npm run verify` gate, strict tsconfig, type-aware eslint + Prettier, vitest running inside the Workers runtime (`@cloudflare/vitest-plugin`), wrangler config
- [x] CI workflow mirroring the gate
- [x] Docs taxonomy, `AGENTS.md`, ADRs 0001–0010, the accepted `_WIP` proposal

Evidence: commits `eeb5fae` (docs) and `ed2f2c5` (scaffold); `npm run verify` green.

## Phase 1 — Platform core (complete, 2026-10-11)

Objective: the platform layer every feature consumes — config, errors, HTTP behavior, validation, list query, the D1 seam, idempotency, caching, health, and a bootable worker — plus harness v0.

- [x] 1.0 Strict quality baseline: type-aware eslint, import hygiene, size/complexity budgets, `no-console`, `eqeqeq`, Prettier (landed 2026-10-10; violation probes confirmed the gates fail)
- [x] 1.1 Config: zod env schema, typed config, fail-fast invariants; the only place `env.*` is read (`src/platform/config`) — landed 2026-10-10; generated `Env` via `wrangler types`; 8 tests green
- [x] 1.2 Clock + errors: injected `Clock`; `ErrorCode` enum + `AppErrorCode` union; typed `AppError` (`src/platform/clock`, `src/platform/errors`, `src/shared/error-codes`) — landed 2026-10-10; 5 tests green; codes mirror the family dialect
- [x] 1.3 HTTP foundation: Hono app + fixed middleware order (request-id → logging → auth → validation), envelope helpers (`data` / `list` / `created` / `noContent`), central problem mapper (`src/platform/http`) — landed 2026-10-10; dialect constants mirrored; 25 tests added
- [x] 1.4 Request validation: zod decode → `errors[] {field, message}` + `VALIDATION_FAILED` — landed 2026-10-10; `errors[]` shape verified against backend; 8 tests added
- [x] 1.5 List query: cursor codec + parse/sort/filter helpers with per-endpoint allowlists (`src/shared/list-query`) — landed 2026-10-10; semantics, where-algebra, and test matrix ported from backend (parity pass closed unknown-param strictness); 50 tests added
- [x] 1.6 DB seam: D1 binding + Drizzle root + drizzle-kit → `wrangler d1 migrations` pipeline + batch helper (`src/platform/db`) — landed 2026-10-10; `Env.DB` wired; CRUD + batch-atomicity tests on local D1; pipeline proven locally (first migration lands with 1.7)
- [x] 1.7 Idempotency: D1-backed records (`in_progress` → `completed`, TTL) + `Idempotency-Replayed` replay (needs 1.6) — landed 2026-10-10; first migration + pipeline E2E in tests; 19 tests added
- [x] 1.8 Cache + logging: in-isolate memoizer (JWKS/config, single-flight), CDN caching policy helper; structured logs + redaction (`src/platform/cache`, `src/platform/logging`) — landed 2026-10-10; one log line per request; 19 tests added
- [x] 1.9 Health + boot: `/health` + `/ready` (envelope-skipped), composition root `src/app.ts` wired through `src/worker.ts` — landed 2026-10-10; backend-shaped readiness 503; 6 tests added
- [x] 1.10 Budget checks: bundle size, crypto allowlist, `env` confinement, KV-write allowlist, cron count — checks wired into the gate (ADR-0005, ADR-0008) — landed 2026-10-10; live probe failed on injected violations; 6 node:test fixtures
- [x] 1.11 cfkit v0: typed command layer + `verify --profile fast|full` + `doctor` + `budget:check`; `npm run verify` delegates to the fast profile; CI runs `verify:ci` (full) — landed 2026-10-10; typed TS on Node native type stripping; 7 node:test fixtures
- [x] 1.12 Drift & docs checks: project map (AGENTS.md tree ↔ dirs), markdown link integrity, `wrangler types` + drizzle migrations drift, ADR index completeness — landed 2026-10-10; live probes for types + migrations (exit 1, restored); map truthed with (planned) markers; 10 new fixtures
- [x] 1.13 Dev deployment: wrangler `dev` environment, first deploy, smoke `/health` + `/ready`, measured CPU per route class recorded as evidence — landed 2026-10-11; dev/staging/prod env blocks + README runbook; local end-to-end green; live temporary-preview deploy (842 KiB upload, 17 ms startup, `/health` 200, `/ready` 503 path); credentialed D1 deploy + dashboard CPU per route tracked as follow-up

Exit gate: `npm run verify` green; worker boots and serves `/health` + `/ready` with `X-Request-Id` echo; envelope, problem, and validation paths covered by tests; budget checks run in the gate; cfkit v0 profiles work locally and in CI; first dev-deployment evidence recorded.

## Phase 2 — Contract pipeline (complete, 2026-10-11)

Objective: the pinned contract and the machinery that proves client parity (ADR-0002, ADR-0003).

- [x] 2.1 Pin backend snapshot: `contracts/backend.openapi.yaml` + `provenance.json` (source commit + SHA-256) — landed 2026-10-11; byte-identical pin at `670d9bc` (61,571 bytes); provenance check wired into the gate; tamper probe failed as expected
- [x] 2.2 Emit `docs/openapi/openapi.yaml` from route definitions (zod-openapi) + drift gate — landed 2026-10-11; OpenAPIHono + createRoute + typed operation metadata; esbuild-bundled emitter; hand-edit and route-change probes both fail; deterministic emit
- [x] 2.3 Parity manifest `tools/parity/coverage.json` (implemented / pending / descoped) + coverage check in the gate — landed 2026-10-11; 34 operations classified exactly once; `$ref`-aware shape parity; live probes for reclassification, descope metadata, and unclassified operations
- [x] 2.4 Contract suite: dialect invariants on live responses — envelope, RFC7807 (`code` + `traceId`), `X-Request-Id` echo, 204 semantics, validation shape — landed 2026-10-11; `test/contract/dialect.spec.ts` (13 tests) on the composed app in-pool; mutation probe failed exactly the broken invariant
- [x] 2.5 Spectral lint with family rules (operationId, tags, `x-error-codes`) + gate-honesty meta-test (inject drift; the check must fail) — landed 2026-10-11; rules mirrored from backend; meta-tests spawn the CLI on temp copies; first run caught and fixed info/global-tag gaps

Exit gate: checks fail on injected drift; downstream retarget documented (provenance swap for frontend/mobile kits).

## Phase 3 — Auth slice (clean tier, in progress)

Objective: the OIDC-first auth surface, contract-green (ADR-0006).

- [x] 3.1 Schema + migrations: users, oidc_identities, sessions, refresh_tokens, idempotency_records — landed 2026-10-11; migration 0001 generated and applied; 5 constraint tests against real D1
- [x] 3.2 OIDC sign-in: ID-token exchange, verification against cached JWKS, user upsert + provider link — landed 2026-10-11; `auth.oidc.exchange` + `auth.oidc.connect` contract-green; platform crypto/auth modules; 61 new tests across 3.1+3.2 (34 spec files, 55 fixtures); review round 1 fixes applied (error-code vocabulary tripwire, keygen script, race + boundary + redaction fixes); client-side authorize/callback stays out of the server contract
- [x] 3.3 Sessions: refresh rotation + reuse detection + logout/revocation — landed 2026-10-11; `auth.refresh` + `auth.logout` contract-green; single-use rotation via a conditional D1 batch (replay or lost race revokes the session family), idempotent logout; 12 new tests (229 total, 36 files); clock-injected deterministic specs
- [ ] 3.4 Access tokens: Ed25519 keyring + JWKS endpoint — exec plan written (queued, committed `dd6ef9e`); issuance + keyring already landed with 3.2
- [ ] 3.5 Auth rate limiting: DO memory-first counters (ADR-0007); boundary lint rules land with the first feature — exec plan written (queued, committed `dd6ef9e`)
- [ ] 3.6 `users/me`: GET / PATCH
- [ ] 3.7 `users/me/sessions`: list / revoke
- [ ] 3.8 Runtime evidence: auth flows measured within the CPU budget on the dev deployment; rows-written recorded

Exit gate: contract suite green for the auth + users surface; `auth.password.*` descope recorded in the manifest; runtime evidence within budget.

## Phase 4 — Background processing + platform services

- [ ] 4.1 Queue platform: producer/consumer helpers, job envelope + trace propagation, retry/backoff defaults, DLQ policy
- [ ] 4.2 First jobs: one fan-out cron + session/credential sweeps; idempotent handler pattern with tests
- [ ] 4.3 R2 module: presign PUT/GET helpers (lands when a feature needs objects)
- [ ] 4.4 Observability pass: log-economy check, `traceId` propagation assertions

Exit gate: job idempotency + retention behavior verified; budget checks include queue ops.

## Phase 5 — cfkit CLI + task governance

Objective: full harness — the simple path is the scaffolded path, and publication requires explicit approval.

- [ ] 5.1 `scaffold feature` / `scaffold endpoint` — output passes `npm run verify` untouched
- [ ] 5.2 `remove feature` — unwires routes/composition/tests cleanly
- [ ] 5.3 Verify profiles `runtime` + `ci`, stable step ids, advisory duration budgets
- [ ] 5.4 Task lifecycle: `task begin/verify`, risk classification (may raise, never lower), bounded repair
- [ ] 5.5 Handoff: `dry-run` + expiring, per-action approvals (commit / push / draft-PR; no merge/deploy)
- [ ] 5.6 Guides (`docs/guide/`: adding-a-feature, config, jobs) + scaffold smoke in CI

Exit gate: a fresh clone scaffolds a working endpoint in one command; a real task ran begin → verify → handoff under explicit approval.

## Phase 6 — Remaining parity (tier 2, optional)

Deferred until a product needs it: `admin`, `merchant-onboarding`. The parity manifest `pending` shrinks to empty or an explicit descope.

## Backlog (ordered, from ADR-0006)

1. **Magic link** (+ email module / Resend adapter) — decided next method
2. **Password revival** — M0 spike first (DO CPU budget on free + WASM Argon2id), then `CredentialHasher` port with `do-argon2` / `inline-argon2` adapters
3. **Passkeys** — `auth.passkeys.*` superset endpoints; family scope cf-first

**Workflows**: deferred until a concrete multi-step saga exists.

## Cross-Cutting Follow-Ups

- [x] Strict quality baseline + violation probes (landed with 1.0)
- [ ] SHA-pin GitHub Actions + least-privilege permissions (ADR-0010)
- [ ] Secrets scan gate (pattern-based, `git ls-files` scoped) in CI
- [ ] Coverage thresholds recorded once the surface stabilizes
- [ ] Duplication policy: blocking core profile with reviewed allowlists (once features exist)
- [ ] Native rate-limiting binding evaluation (swap candidate for DO counters)
- [ ] Tail Worker / OTLP export hook (documented, off by default)
- [ ] `docs/standards/free-tier-budget.md` completed with measured envelopes per route class

## Open Items Kept Visible

- `auth.password.*` descoped — declared in the parity manifest; revival path is the backlog
- M0 spike deferred with the password backlog item
- Runtime evidence (CPU, rows written): preview-lane startup (17 ms) + local wall-clock proxies recorded (1.13); dashboard CPU per route class pending the credentialed D1 deploy
- The `pending` / `descoped` operation inventory must stay explicit in `tools/parity/coverage.json` from Phase 2 on
