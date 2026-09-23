# Roadmap

- Status: living document — update as phases and tasks land
- Updated: 2026-10-11
- Scope: high-level phases, task tracking, and exit gates. Details live in per-task execution plans.

## How To Use

- This roadmap is the index; it never replaces an execution plan.
- Every task gets a plan from `_template.md` stored in `docs/exec-plans/active/` before work starts; completed plans move to `docs/exec-plans/completed/` with verification evidence.
- Update checkboxes and "Current Focus" as tasks complete. A task is done only when its gate actually ran.
- `npm run verify` delegates to `cfkit verify --profile fast` (CI runs `verify:ci`, the `ci` profile: fast steps plus coverage, duplication, build, and the runtime and scaffold smokes) — the standing gate for every task; phases add gates (budget checks, drift checks, contract suite, secrets scan).
- Decisions that change a baseline require an ADR first (see `docs/adr/README.md`).

## Harness

The harness keeps quality golden; it is mandatory, not optional. Layers, in landing order (practices ported from backendkit, frontendkit, mobilekit, and gokit):

1. **Strict lint/format baseline** (landed, 1.0): type-aware eslint (`strictTypeChecked` + `stylisticTypeChecked`), import hygiene (`import-x`: first, newline-after-import, no-cycle, no-duplicates, no-mutable-exports), budgets (complexity 12, max-lines 350, max-lines-per-function 80), `no-console`, `eqeqeq`, Prettier. Violation probes confirmed the gates fail with their expected markers.
2. **Budget checks** (landed, 1.10): the free-tier guardrails are real checks (ADR-0005, ADR-0008) — bundle size, crypto allowlist, `env` confinement, KV-write allowlist, cron count — wired into the verify gate.
3. **cfkit v0** (landed, 1.11): typed command layer, `verify --profile fast|full`, `doctor`, `budget:check`; `npm run verify` delegates to the fast profile; CI calls the same profile.
4. **Drift & docs checks** (landed, 1.12): project map (AGENTS.md tree ↔ dirs), markdown link integrity, `wrangler types` + drizzle migrations drift, ADR index completeness.
5. **Contract gates** (landed, 2.1–2.5): snapshot pin + provenance, emitted OpenAPI + drift gate, parity manifest check, Spectral family rules, and the contract suite — each gate carrying a gate-honesty meta-test.
6. **Feature-level enforcement** (in progress, 3.x–5.x): `env` confinement and the crypto allowlist already gate through budget checks (1.10); boundary lint rules landed with 3.5 (platform ↛ features, `src/shared` purity, cross-feature surfaces — each proven by violation probes); scaffold output smoke-tested against `npm run verify` and `remove feature` unwiring land with Phase 5; duplication policy and runtime evidence later.

Rules: findings gate on **new vs baseline**, and baseline updates require explicit approval (never silent). Profiles are defined once (fast/full/runtime/ci), fail-fast with stable step ids and advisory duration budgets. A gate that cannot fail is not a gate — every new gate ships with a violation probe or a meta-test.

## Current Focus

**Every roadmap checkbox is closed.** Phases 0–5 are complete, Phase 6's cross-cutting follow-ups are complete, and the published history ends with the harness, gates, and docs current (see the publication plan's record). What remains is deliberately not scheduled here because each item is gated on a decision only the product owner can make:

- **Backlog #1 — Magic link** (+ email module / Resend adapter): needs the method decision confirmed, an email-provider credential (Resend), and family contract surface — the pinned snapshot has `auth.email.verify` / `auth.email.verification.resend` but no magic-link sign-in operations.
- **Backlog #2 — Password revival**: M0 spike first (DO CPU budget on the free plan + WASM Argon2id), then the `CredentialHasher` port with `do-argon2` / `inline-argon2` adapters; `auth.password.*` stays descoped until then.
- **Backlog #3 — Passkeys**: needs `auth.passkeys.*` superset endpoints in the family contract.
- **Phase 6 surfaces — `admin`, `merchant-onboarding`**: deferred until a product needs them; the 18 pending pinned operations are the tier-2 parity backlog (`cfkit scaffold endpoint` implements the simple ones in one command once a product wants them).
- **Credentialed lanes**: dashboard CPU per route class, a live R2 upload, and the first real deploy — each tracked in its plan.

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

## Phase 3 — Auth slice (clean tier, complete 2026-10-11)

Objective: the OIDC-first auth surface, contract-green (ADR-0006).

- [x] 3.1 Schema + migrations: users, oidc_identities, sessions, refresh_tokens, idempotency_records — landed 2026-10-11; migration 0001 generated and applied; 5 constraint tests against real D1
- [x] 3.2 OIDC sign-in: ID-token exchange, verification against cached JWKS, user upsert + provider link — landed 2026-10-11; `auth.oidc.exchange` + `auth.oidc.connect` contract-green; platform crypto/auth modules; 61 new tests across 3.1+3.2 (34 spec files, 55 fixtures); review round 1 fixes applied (error-code vocabulary tripwire, keygen script, race + boundary + redaction fixes); client-side authorize/callback stays out of the server contract
- [x] 3.3 Sessions: refresh rotation + reuse detection + logout/revocation — landed 2026-10-11; `auth.refresh` + `auth.logout` contract-green; single-use rotation via a conditional D1 batch (replay or lost race revokes the session family), idempotent logout; 12 new tests (229 total, 36 files); clock-injected deterministic specs
- [x] 3.4 Access tokens: Ed25519 keyring + JWKS endpoint — landed 2026-10-11; `auth.jwks.get` contract-green (five auth operations emitted); rotation-ready multi-key ring (first private key signs, retired keys stay published); pre-rotation tokens verify after rotation; 5 new tests (234 total, 37 files)
- [x] 3.5 Auth rate limiting: DO memory-first counters (ADR-0007); boundary lint rules land with the first feature — landed 2026-10-11; ADR-0012; hibernating memory-first `AuthRateLimiter` (one DO request per auth op, fail-open, no storage writes); 429 dialect with `Retry-After` (undeclared by design, parity preserved); boundary lint zones with committed meta-test probes; review round 2 applied (per-bucket DO objects, headerless skip, pure window tests); 252 tests across 39 files + 60 fixtures
- [x] 3.6 `users/me`: GET / PATCH — landed 2026-10-11; both contract-green (11 implemented operations); raw-body unknown-field rejection; method-scoped idempotent PATCH; 13 new tests (265 total across 40 files)
- [x] 3.7 `users/me/sessions`: list / revoke — landed 2026-10-11; cursor pagination via the shared pipeline (first consumer), status precedence, idempotent revoke reusing the token-family helper; 9 new tests + a cross-feature integration spec (275 total across 42 files)
- [x] 3.8 Runtime evidence — landed 2026-10-11; live wrangler-dev run (migrations + seeded D1 + minted Ed25519 token) covering the full auth/users surface, rows-written table with counted spot checks, latency table (curl + server-side); credentialed dashboard CPU for the dev deployment tracked as the remaining follow-up

Exit gate: contract suite green for the auth + users surface; `auth.password.*` descope recorded in the manifest; runtime evidence within budget.

## Phase 4 — Background processing + platform services (complete 2026-10-11)

- [x] 4.1 Queue platform: producer/consumer helpers, job envelope + trace propagation, retry/backoff defaults, DLQ policy — landed 2026-10-11; one work queue + DLQ per environment (names/bounds/DLQ linkage budget-checked), versioned envelope with trace propagation, explicit per-message ack/retry with 30s-exponential+jitter backoff, DLQ consumer, worker `queue` handler; `queues-jobs` standard normative; 18 new tests + 4 budget fixtures
- [x] 4.2 First jobs: one fan-out cron + session/credential sweeps; idempotent handler pattern with tests — landed 2026-10-11; hourly cron enqueues `auth.purgeExpiredSessions` + `http.purgeExpiredIdempotencyRecords` (deterministic per-tick ids, `cron:<iso>` trace); bounded deletes (`SWEEP_BATCH_SIZE`), cascade-verified; per-scope cron budget check; real queue delivery exercised in the pool (`queueConsumers`) with tick-idempotency proven; 8 new tests (301 total across 48 files)
- [x] 4.3 R2 module: presign PUT/GET helpers (lands when a feature needs objects) — landed 2026-10-11; path-style SigV4 presigned GET/PUT via the pinned `aws4fetch` signer (reproduces the documented AWS vector in the suite; frozen golden URLs), 300s default / 604800s cap, segment-validated keys, `INTERNAL` when unconfigured, secret redacted, dependency confined by a budget rule; 11 new tests (312 total across 50 files); first consumer = the users profile-image flow in the parity backlog
- [x] 4.4 Observability pass: log-economy check, `traceId` propagation assertions — landed 2026-10-11; console confined to the platform logger by a budget rule with fixtures; counted economy specs (one line per request, zero for probes, exactly one failure line) and full header/problem/log id continuity for supplied and generated ids; normative `observability` standard; 4 new tests (316 total across 51 files) + 1 budget fixture (68 total)

Exit gate: job idempotency + retention behavior verified (tick-idempotency proven through real queue delivery, bounded deletes with cascade); budget checks include queue ops (queue config bounds, DLQ linkage, per-scope cron, binding + signer + console confinement).

## Phase 5 — cfkit CLI + task governance (complete 2026-10-11)

Objective: full harness — the simple path is the scaffolded path, and publication requires explicit approval.

- [x] 5.1 `scaffold feature` / `scaffold endpoint` — output passes `npm run verify` untouched — landed 2026-10-11; endpoint scaffolds implement pending pinned 204 operations (route + spec + three anchored edits + manifest move preserving provenance + automatic `contract:emit`); feature scaffolds create the slice and wire the cross-feature lint zones; live cycles green (endpoint → full profile, 318 tests; feature → fast profile) and fully reverted; 4 real bugs found by the cycles and pinned by tests
- [x] 5.2 `remove feature` — unwires routes/composition/tests cleanly — landed 2026-10-11; `remove endpoint` + `remove feature` reverse every scaffold edit (three code anchors, zone blocks, manifest move, automatic `contract:emit`) with marker-checked refusals (hand-written routes, hand-edited features, protected cores behind `--force-core`, `--yes` confirmation); live round trip restores all five touched artifacts byte-for-byte (manifest arrays canonicalized to make moves position-stable); 4 new tests (83 fixtures total)
- [x] 5.3 Verify profiles `runtime` + `ci`, stable step ids, advisory duration budgets — landed 2026-10-11; `runtime` is the committed boot smoke (wrangler dev + health/ready/JWKS assertions, self-cleaning), `ci` composes `full` + `runtime` with cycle detection, steps carry stable ids, and advisory budgets warn without failing (baselines calibrated from the first ci run: 75s observed vs 360s advisory); `npm run verify:ci` now runs the ci profile; 2 new tests (85 fixtures total)
- [x] 5.4 Task lifecycle: `task begin/verify`, risk classification (may raise, never lower), bounded repair — landed 2026-10-11; plan-driven begin (status/risk headers), path classification with stable rule ids and raise-only max semantics, lane selection (low → fast, medium/high → full, runtime paths → ci), bounded repair with per-step fingerprints and escalation after the repair limit, state under gitignored `.cfkit/`; live begin → verify → status on this very task; 7 new tests (92 fixtures total)
- [x] 5.5 Handoff: `dry-run` + expiring, per-action approvals (commit / push / draft-PR; no merge/deploy) — landed 2026-10-11; dry-run binds the approval to action/revision/paths with a one-time challenge (hash-only, `0600`, 15-minute expiry), mutations re-verify everything before acting, commit stages exactly the approved paths and refuses foreign staged work, push is non-force, draft-pr degrades to printing the `gh` command, and merge/deploy/migrate/force-push are absent by test; live scratch-repo cycle (commit + push + refusals) caught three real bugs (path parsing offset, untracked-directory staging, unhandled mutation throw); 5 new tests (97 fixtures total)
- [x] 5.6 Guides (`docs/guide/`: adding-a-feature, config, jobs) + scaffold smoke in CI — landed 2026-10-11; four guides (+ index) mirror the tools and their refusals; `scripts/scaffold/smoke.mjs` scaffolds a feature + a real pending operation, verifies the scaffolded tree, removes both, and asserts byte-identical restoration before verifying again — wired as the stable-id `scaffold.smoke` step in the ci profile (39s); found and fixed the missing `URL` mjs global and restored the 5.2 manifest sorting

Exit gate: a fresh clone scaffolds a working endpoint in one command (proven on every ci run by the scaffold smoke, and by the live endpoint cycle); a real task ran begin → verify → handoff under explicit approval (the task-lifecycle task ran begin → verify live, and the handoff cycle committed and pushed under a one-time expiring approval in a scratch repo).

## Phase 6 — Remaining parity (tier 2, optional)

Deferred until a product needs it: `admin`, `merchant-onboarding`. The parity manifest `pending` shrinks to empty or an explicit descope.

## Backlog (ordered, from ADR-0006)

1. **Magic link** (+ email module / Resend adapter) — decided next method
2. **Password revival** — M0 spike first (DO CPU budget on free + WASM Argon2id), then `CredentialHasher` port with `do-argon2` / `inline-argon2` adapters
3. **Passkeys** — `auth.passkeys.*` superset endpoints; family scope cf-first

**Workflows**: deferred until a concrete multi-step saga exists.

## Cross-Cutting Follow-Ups

- [x] Strict quality baseline + violation probes (landed with 1.0)
- [x] SHA-pin GitHub Actions + least-privilege permissions (ADR-0010) — landed 2026-10-11; workflow pinned to released commit SHAs with tag comments, `permissions: contents: read`, concurrency, `npm ci --include=dev`; invariants enforced by `scripts/ci/workflow.test.mjs` with both probes recorded
- [x] Secrets scan gate (pattern-based, `git ls-files` scoped) in CI — landed 2026-10-11; `secrets:check` scans tracked files for private keys, AWS-style key ids, private JWKs (incl. pretty-printed), and secret-valued assignments; documented allowlists for the AWS example and the test fixtures; runs in the fast profile
- [x] Coverage thresholds recorded once the surface stabilizes — landed 2026-10-11; `test:coverage` (v8 provider through the Workers pool) measured 88.6% statements / 82.5% branches / 94.0% functions / 91.9% lines with floors set just below (85/78/90/88), wired as a `full`-profile step (~53s); the raised-threshold probe fails and is recorded
- [x] Duplication policy: blocking core profile with reviewed allowlists (once features exist) — landed 2026-10-11; `jscpd` (min-tokens 60) over src/scripts/tools with generated artifacts and test files excluded; the two real source clones were refactored away and the one remaining clone (script entrypoint boilerplate) is allowlisted with its reason; `duplication:check` runs in full/ci; the emptied-allowlist probe fails and is recorded
- [x] Native rate-limiting binding evaluation (swap candidate for DO counters) — evaluated 2026-10-11; kept the DO counters (ADR-0012) because the binding is documented as per-location, eventually consistent, and "not … an accurate accounting system", and exposes no `Retry-After` signal; revisit triggers recorded in the evaluation plan
- [x] Tail Worker / OTLP export hook (documented, off by default) — documented 2026-10-11 in the observability standard: Workers OTLP export is the supported path (config sketch, sampling, `persist: false` cost note — persisted data bills from 2026-12-01), Tail Workers are paid/enterprise-only so no hand-rolled forwarder exists, and no destination is wired in any scope
- [x] `docs/standards/free-tier-budget.md` completed with measured envelopes per route class — landed 2026-10-11; normative rules each mapped to their enforcement, the verified platform envelope (Workers Free / D1 / Queues / DO), and the measured evidence (bundle 1218 KiB, startup 17 ms, per-route wall-clock p50s, sweep/write row counts); standards index marks it normative

## Open Items Kept Visible

- `auth.password.*` descoped — declared in the parity manifest; revival path is the backlog
- M0 spike deferred with the password backlog item
- Runtime evidence (CPU, rows written): preview-lane startup (17 ms) + local wall-clock proxies recorded (1.13); dashboard CPU per route class pending the credentialed D1 deploy
- The `pending` / `descoped` operation inventory must stay explicit in `tools/parity/coverage.json` from Phase 2 on
