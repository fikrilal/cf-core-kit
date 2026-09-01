# cf-core-kit — Architecture Proposal

**Status:** accepted for planning (2026-10-10) — decisions promoted to `docs/adr/`
**Date:** 2026-10-10
**Revision:** r3 — backlog order decided (magic link → password revival → passkeys); remaining open questions resolved (§9 decisions log)
**Scope:** v1 architecture for `cf-core-kit` — standalone Cloudflare Workers backend core kit
**Authority:** none — advisory design record; no implementation is authorized by this document
**Graduation:** once accepted, decisions distill into `docs/adr/` ADRs and `docs/standards/` docs (family convention)

---

## 1. Summary

`cf-core-kit` is the Cloudflare counterpart to `backend-core-kit`: a standalone, copy-per-project backend core kit that speaks the family's API contract dialect on the Workers platform (password operations descoped — §5.8), engineered to operate inside **Cloudflare Workers Free plan budgets**.

Recommended shape:

- **One Worker script** per deployment (HTTP + queue consumer + cron + Durable Object classes), Hono for routing, zod-openapi for contract generation.
- **D1 + Drizzle** as the baseline data plane; repository ports keep a future Postgres/Hyperdrive adapter additive, not a rewrite.
- **Core module is the product**: request pipeline (request-id, envelope, problem details, validation, idempotency), config, db, cache, queue, storage, email, logging, clock, errors, crypto policy. Features stay thin.
- **Auth is OIDC-first**: OIDC sign-in flows into the family session/token model (D1 refresh rotation + Ed25519 access JWT + JWKS). Password authentication is **descoped** from v1 — the one deliberate deviation from full contract parity. Backlog methods are ordered — magic link first, then password revival, then passkeys — each plugging into the same principal → session-issuance funnel when picked up.
- **Free-tier budget is a first-class standard** with mechanical guardrails (write budgets, KV write prohibition, cron count, crypto allowlist, bundle size).
- **Verification and harness mirror the family**: verify profiles (fast / full / runtime / ci), scaffold-driven features, docs as source of truth, ADRs for durable decisions.

## 2. Context And Problem

### Family and role

The kit family at `~/workspace/devs/core/`:

| Kit                    | Stack                              | Role                                                              |
| ---------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| `backend-core-kit`     | NestJS + Fastify + Postgres/Prisma | Reference backend; owns the API contract                          |
| `frontend-core-kit`    | Next.js                            | Consumes the contract via committed OpenAPI snapshot + provenance |
| `mobile-core-kit`      | Flutter                            | Consumes the contract; scaffolds data layers from it              |
| `cf-core-kit` (this)   | Cloudflare Workers                 | Standalone edge backend, contract-dialect-identical               |
| `go-core-kit` (future) | Go                                 | Later family member; contract is the shared spine                 |

Kits are **standalone templates** (clone-and-customize). They share conventions and the contract dialect, not code.

### Why the free tier changes the engineering problem

The question is not "can this work on Workers" but "can this honor the contract inside these budgets": 100k requests/day **account-wide**, 10ms CPU per invocation, 100k D1 rows written/day, 1k KV writes/day, ~3.3k queue deliveries/day, and no external services for core paths. Several design areas (state storage, background work, auth method choice) are decided by these numbers rather than by taste.

The password case is the sharpest analysis: safe password hashing needs 50–300ms CPU per attempt, the free tier allows 10ms, and the Workers runtime additionally hard-caps WebCrypto PBKDF2 at 100,000 iterations (`NotSupportedError`; workerd PR #1471 made the cap configurable, 100k is the unconfigured default). Durable Objects are the only place on the platform documented with a 30-second default CPU budget per invocation. This analysis drove the auth decision (§5.8): **v1 ships OIDC-only, and password authentication is descoped** rather than engineered around, with the DO/WASM-Argon2id path and its platform spike (M0) moved to the backlog.

## 3. Goals And Non-Goals

### Goals

- **G1 — Contract dialect parity (scoped surface).** Implement the `backend-core-kit` dialect exactly: `{ data, meta? }` envelope, RFC7807 problem details with stable SCREAMING_SNAKE codes + `traceId`, dotted operationIds, `X-Request-Id` echo, 204 semantics, `x-error-codes` per operation. Emit the same `docs/openapi/openapi.yaml` artifact shape so `frontend-core-kit` and `mobile-core-kit` can retarget by provenance swap. The implemented operation set is tracked in the parity manifest; password operations are descoped (§5.8).
- **G2 — Free-tier operable by default.** A modest project runs entirely on Workers Free: no external database, no paid observability stack, no paid queue broker.
- **G3 — Performance.** Edge-first execution, aggressive in-isolate memoization, cacheable public GETs, lean CPU/bundle profile.
- **G4 — Family consistency.** Core module pattern, progressive feature architecture with optional usecase/clean tiers, boundaries enforced mechanically, docs as source of truth, ADR workflow, harness + verify profiles.
- **G5 — OIDC-first auth.** OIDC sign-in, sessions + refresh rotation, access JWT + JWKS; no password material stored. Backlog methods (magic link → password revival → passkeys) ride the same session-issuance funnel.

### Non-Goals (v1)

- Password authentication (descoped — see §5.8 and the parity manifest).
- Passkeys, magic link, and password revival in v1. Backlog order is decided: magic link → password revival → passkeys.
- External Postgres/Hyperdrive as a baseline (kept as an optional future adapter behind ports).
- Admin control plane and merchant-onboarding feature parity (roadmap milestones after the core surface).
- External observability exporters by default (OTLP collector is an optional hook).
- Monorepo / shared package with sibling kits (family rule: standalone templates).
- Multi-worker topology in v1 (single script; service binding split stays open later).

## 4. Constraints And Invariants

### 4.1 Free-tier operating budget (verified 2026-10, Cloudflare docs)

| Resource                  | Free allowance                                                            | Engineering implication                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Workers requests          | 100,000/day, **account-wide**, resets 00:00 UTC                           | Scarcest resource; CDN-served cache hits that don't invoke the Worker don't count; every design must be request-efficient      |
| Workers CPU               | 10ms per HTTP request; 10ms per cron invocation                           | Auth-heavy requests "typically use 10–20ms" per CF docs; hard CPU diet required                                                |
| Subrequests               | 50/request                                                                | Bounds per-request D1/KV/R2/fetch fan-out                                                                                      |
| Cron triggers             | 5/account                                                                 | One fan-out cron per project maximum                                                                                           |
| Env vars                  | 64/Worker, 5KB each                                                       | Bindings/secrets via wrangler                                                                                                  |
| Memory / startup / bundle | 128MB isolate; 1s startup; 64MiB uncompressed                             | Keep deps lean; lazy per-route imports                                                                                         |
| D1                        | 5M rows read/day; 100k rows written/day; 5GB                              | Rows counted, not bytes; each index on a written column adds a write; DDL counts; ~1 write/request is the sustainable envelope |
| KV                        | 100k reads/day; **1k writes/deletes/list per day**; 1GB                   | Read-cache only; never on a write path; eventual consistency (60s) disqualifies it for state                                   |
| Queues                    | 10k ops/day (~3.3k messages; delivery = write+read+delete); 24h retention | Async jobs only; retries cost extra reads; no long-running sagas here                                                          |
| Durable Objects           | SQLite-backed only; 100k req/day; 13,000 GB-s/day; storage 5GB/account    | Budget ≈ one always-active 128MB object per day (≈10.8k GB-s); design for hibernation                                          |
| R2                        | 10GB; 1M Class A / 10M Class B ops per month; free egress                 | Direct client uploads via presigned URLs                                                                                       |
| Workflows                 | 3,000 steps/day; requests share the Workers quota                         | Optional; for multi-step sagas only                                                                                            |
| Workers Logs              | 200k events/day, 3-day retention                                          | Primary observability; no Logpush on free                                                                                      |

### 4.2 Contract dialect invariants (non-negotiable)

- Success: `{ data, meta? }`; list responses carry `{ items, nextCursor?, limit?, hasMore? }` → meta.
- Errors: `application/problem+json` with `{ type, title, status, code, traceId }` (+ optional `errors[]` for validation).
- `code` values are SCREAMING_SNAKE, drawn from typed enums (`ErrorCode` ∪ feature enums); no raw string literals.
- `X-Request-Id` accepted (validated) or generated; echoed on every response; mirrored into `traceId`.
- 204 responses are bodyless; writes that create resources return `Location` where the backend does.
- Operation IDs are dotted (e.g. `users.me.sessions.revoke`, `users.me.get`) and drive generated client names downstream.
- Every operation declares `x-error-codes`; the OpenAPI snapshot is committed and lint-gated.

### 4.3 Platform runtime caps (discovered, must be designed around)

- **PBKDF2 ≤ 100,000 iterations** (workerd runtime cap; above → `NotSupportedError`). Below OWASP guidance (600k). Relevant only if password auth is revived from the backlog.
- **DO CPU budget on free plan is ambiguous in the docs** ("same limits as any Workers" vs "30 seconds default per invocation, configurable"). Deferred with the password backlog item; no v1 design depends on the resolution.
- **CPU-time accounting**: I/O waits don't count; computation (JS, WASM, crypto) does. This is why "do more I/O, less compute" is a design rule, not a slogan.
- Platform limits evolve; the budget standard (§6) is versioned and re-verified when Cloudflare changes pricing/limits.

### 4.4 Engineering invariants (family style)

- TypeScript strict; no `any`, no `as` assertions to silence the compiler.
- App-layer time via injected `Clock`; no ad-hoc `new Date()`/`Date.now()` in services.
- Raw binding access (`env.*`) only inside `platform/config` and platform modules; features receive typed ports/values.
- Simplicity first: smallest feature structure that fits the maintenance pressure; no speculative abstraction; usecases optional (never pure pass-throughs).
- Boundaries enforced mechanically (dependency rules, lint allowlists, budget checks), not by review memory.
- Docs are the source of truth; a repeated failure escalates into a guardrail (config → lint → CLI → scaffold → doc).
- No secrets in git; no commits/pushes without explicit authorization.

## 5. Proposed Architecture

### 5.1 Runtime topology

One Worker script per deployment; concerns are handlers, not separate services.

```
Client ──► Cloudflare edge (CDN cache when eligible)
              │
              ▼
        Worker (single script, one deploy unit)
        ├── fetch handler ........ HTTP API (Hono + middleware pipeline)
        ├── queue handler ........ consumer for background jobs
        ├── scheduled handler .... cron triggers (≤ 5 / account → 1 fan-out cron)
        └── DO classes ........... stateful coordination (few, hibernating)
              │
Bindings ─────┼── D1            (SQL: sessions, users, idempotency, jobs state)
              ├── KV            (read cache only — rare writes)
              ├── R2            (objects; direct client upload/download via presign)
              ├── Queues        (jobs producer/consumer)
              └── Durable Objects (rate-limit counters; future auth material)
External ─────┴── OIDC providers (v1 auth) · Resend (email, deferred) · FCM (push, optional)
```

- Wrangler environments map to `dev` / `staging` / `prod` with per-env bindings and vars; secrets via `wrangler secret`.
- The Worker exports `fetch`, `queue`, `scheduled`, and DO classes from one entrypoint; splitting into additional Workers via service bindings stays a later option, not a v1 default.

### 5.2 Core module — `platform/`

Owns every cross-cutting concern; features depend on it, it never imports features. Modules:

| Module     | Provides                                                                                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config/`  | zod-validated env + bindings from the Worker `env`; typed `AppConfig`; the only place `env.*` is read                                                                                                                         |
| `http/`    | Middleware pipeline: request-id (validate/generate/echo), structured logging context, response envelope, problem-details error mapping, zod request validation, list-query (cursor codec/parsers), idempotency, rate limiting |
| `db/`      | D1 client + Drizzle root schema; batch/transaction helpers; retry taxonomy (none automatic for D1; explicit)                                                                                                                  |
| `cache/`   | In-isolate memoizer (ttl + single-flight) for JWKS/config; CDN caching helpers (`Cache-Control`/`s-maxage` policy per route class)                                                                                            |
| `queue/`   | Producer/consumer helpers; job envelope + trace propagation; retry/backoff defaults; DLQ policy                                                                                                                               |
| `storage/` | R2 presign (PUT/GET), key policy, TTL bounds                                                                                                                                                                                  |
| `email/`   | Resend adapter behind `EmailService` port (deferred with the email-dependent backlog items)                                                                                                                                   |
| `push/`    | FCM adapter behind `PushService` port (optional)                                                                                                                                                                              |
| `clock/`   | `Clock` interface + `SystemClock`; test clocks                                                                                                                                                                                |
| `errors/`  | `ErrorCode` enum, `AppErrorCode` union, problem mapping, `AppError` class                                                                                                                                                     |
| `crypto/`  | Algorithm allowlist: Ed25519/ES256 for first-party sign+verify; RS256 verification for OIDC ID tokens (public-key verify only — no RSA signing); HMAC-SHA256 for tokens/ids; timing-safe compare                              |
| `ids/`     | ID strategy (UUIDv7-style sortable IDs) — no extra rows for sequences                                                                                                                                                         |

Naming/observation rules: middleware order is fixed (request-id → logging → auth → validation → handler → envelope/problem), matching backend semantics.

### 5.3 Contracts and parity pipeline

- Routes defined with zod schemas via an openapi-enabled Hono layer; `pnpm contracts:generate` emits `docs/openapi/openapi.yaml` (committed) and runs Spectral with family rules (`operationId`, tags, `x-error-codes` required).
- **Parity manifest** (`tools/parity/coverage.json`, sketch):

```jsonc
{
  "source": {
    "repo": "backend-core-kit",
    "path": "docs/openapi/openapi.yaml",
    "commit": "<sha>",
  },
  "implemented": ["users.me.get", "users.me.sessions.revoke", "..."],
  "pending": ["admin.*", "merchant-onboarding.*"],
  "descoped": [
    {
      "operations": ["auth.password.*"],
      "reason": "Password auth removed from cf-core-kit scope (ADR-000X); OIDC is the v1 sign-in method",
      "revisit": "Backlog: M0 spike (DO CPU budget) → WASM Argon2id adapter",
    },
  ],
}
```

- CI check: implemented operations exist in the cf snapshot with matching shape (params/envelope/error codes); removing/changing an implemented operation fails the gate; descoped operations must be declared here and in the ADR.
- Downstream kits retarget by swapping `provenance.json` (their existing sync/check tooling works unchanged).

### 5.4 Data and persistence

- **D1 + Drizzle** baseline. Schema in `platform/db/schema` (root) + feature-owned tables colocated with features.
- Migrations generated by drizzle-kit, applied via `wrangler d1 migrations`; committed and reviewed; no runtime DDL.
- **Transaction semantics**: D1 has no interactive multi-await transactions — invariant: multi-statement atomic writes use `batch()` or single statements; cross-request consistency handled via idempotency keys and status machines.
- **Write discipline**: endpoint budget target ≤ 2–3 rows written per API write request (index amplification included); enforced by review checklist now, by budget checks/telemetry later.
- **Index discipline**: an index costs an extra row write per write touching its column; add indexes only for proven read patterns (reads are cheap, writes are not).
- **Sessions / refresh**: D1 tables with rotation + reuse detection; TTL sweep via the fan-out cron. Strong consistency required — this is why KV is excluded.
- **Idempotency**: D1 unique-key records with a status machine (`in_progress` → `completed`, response cache, TTL) mirroring backend semantics; no KV.

### 5.5 Platform service mapping

| backend-core-kit capability | cf-core-kit primitive                     | Notes / guard                                                                           |
| --------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Postgres/Prisma             | D1 + Drizzle                              | Rows-read/write budgets; ports keep PG adapter additive                                 |
| Redis (idempotency, locks)  | D1 (records) + DO (counters)              | No KV on write paths                                                                    |
| BullMQ                      | Queues                                    | ~3.3k msgs/day; 24h retention; at-least-once → idempotent handlers                      |
| S3/MinIO presign            | R2 presign                                | Direct client transfer; Worker never proxies payloads                                   |
| Resend email                | Resend over `fetch`                       | Not on the v1 critical path (OIDC verifies email at the IdP); revisited with magic link |
| FCM push                    | FCM over `fetch`                          | Optional module                                                                         |
| Nest DI                     | Composition root (`app.ts`)               | Explicit wiring; no container                                                           |
| pino + OTel                 | Structured logs + `traceId`/request-id    | Workers Logs (200k events/day); OTLP exporter optional hook, off by default             |
| Health/ready                | `/health` (liveness), `/ready` (D1 probe) | Cheap; not CDN-cached                                                                   |

### 5.6 Background processing

- **Queues** carry async jobs (notifications, sweeps; email when an email-dependent feature lands). Job payload contracts shared like the backend's job contracts; handlers idempotent by `jobId`; bounded retries with jitter; DLQ policy explicit (ops counted).
- **One fan-out cron** (of the account's 5): enqueue sweep/cleanup jobs, publish scheduled work; keep cron CPU tiny (enqueue, don't process).
- **DO alarms** only for object-internal clockwork (e.g., counter flush, session cleanup), never as a global scheduler.
- **Workflows**: deferred. Adopt only if a multi-step saga needs it (3k steps/day budget).

### 5.7 Durable Objects policy

- Few objects, hibernation-first, memory-first counters with batched persistence.
- **v1 DO usage**: rate-limit counters for auth paths (memory-first, hibernating). Future methods add objects only when they earn it — the backlog password design uses a per-user `CredentialKeeper` DO (credential material isolated from the main D1).
- Budget rule: no always-on object patterns; ≤ 1 DO request per auth operation; alarms sparingly (each is a request + duration + storage write).
- The deferred M0 spike (§5.8) gates any password hashing; nothing on the v1 path depends on its outcome.

### 5.8 Auth architecture

**OIDC-first (v1).** Sign-in is delegated to OIDC providers; the kit owns everything after: principal → session issuance. The funnel is an architectural seam — future methods plug in without touching the session/token model:

```
OIDC (v1):        authorize/callback → code exchange → ID-token verify ─┐
Backlog methods:  magic link · password* · passkeys ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┼─► principal ─► session issuance
                  (* password is descoped; spike-gated if revived)     ┘   (D1 refresh rotation + Ed25519 JWT + JWKS)
```

**v1 surface**

- OIDC sign-in: authorize redirect + callback with `state`/PKCE, code exchange (one `fetch`), ID token verification against cached JWKS (RS256 public-key verify — sub-ms), user upsert + provider link.
- Sessions: opaque refresh tokens in D1 with rotation + reuse detection; TTL sweep via the fan-out cron.
- Access tokens: Ed25519 (EdDSA), verified natively in WebCrypto; JWKS endpoint served from config.
- Logout/revocation endpoints per contract semantics.
- Auth-path rate limiting: DO memory-first counters (decided); generic rate limiting deferred.
- **No password material is stored anywhere in v1** — no hasher, no adapters, no dead abstraction.

**Descoped: password authentication**

`auth.password.*` operations are removed from scope — a deliberate, documented deviation from full contract parity:

- Routes are **not mounted** (no stub routes returning fake codes).
- The parity manifest records the operations under `descoped` with the ADR reference (§5.3).
- Downstream projects pointing at the cf snapshot simply have no password operations; per-project frontend/mobile config skips password UI.

**Backlog methods (ordered; pick up when a project needs one)**

| Method     | Why it's backlog                                                                                                               | Shape if revived                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Magic link | **Decided next method**: CPU-cheap, but makes email delivery auth-critical (Resend quota, deliverability, domain verification) | Token rows in D1 + email module; new superset endpoints                                                                                                  |
| Password   | **Decided second**: requires the deferred M0 spike (DO CPU on free) + WASM Argon2id                                            | `CredentialHasher` port (`do-argon2` / `inline-argon2` adapters, `{alg, params, salt, digest}` records + `needsRehash` upgrade path); OWASP-grade params |
| Passkeys   | Signature verify only (free-tier trivial), no email dependency — third in order, picked up after the two above if needed       | New `auth.passkeys.*` superset endpoints; family scope: cf-first superset (decided)                                                                      |

The deferred **M0 spike**: deploy a minimal free-plan Worker + DO; the DO runs `hash-wasm` Argon2id at moderate params (e.g., m=19456 KiB, t=2, p=1) and a PBKDF2 control at ≤100k iterations; record invocation outcome (`exceededCpu`?) and CPU metrics from Workers Logs. Evidence to `_WIP/`, decision to an ADR — only if/when the password item is picked up.

Precedent for passkeys: `BlockchainCommons/passkey-cloudflare` (DO-based identity), `@simplewebauthn/server` on Workers.

### 5.9 Feature architecture and naming

- **Capability slice is the default** (flat tier); a **clean tier** (`app/` + `infra/`) exists behind a scaffold flag for flows that earn it — mirroring backend ADR 0018.
- **Usecase is optional** (mobile-core-kit rule): add one only when the operation has logic worth isolating (final validation gate, multi-step orchestration, rule needing its own test); pure pass-throughs are forbidden.
- Feature tree (example: `auth`):

```
src/
  worker.ts                    # fetch/queue/scheduled handlers + exports
  app.ts                       # composition root (route mounting, middleware assembly)
  platform/                    # core module (§5.2)
  shared/                      # framework-free: error codes, list-query, time
  features/
    auth/
      auth.routes.ts           # route defs + zod schemas, operationIds
      auth.service.ts          # usecase-level orchestration (or direct repository for simple reads)
      auth.repository.ts       # port
      auth.d1.repository.ts    # D1/Drizzle adapter
      auth.errors.ts           # feature error class + codes re-export
      auth.module.ts           # wiring
      sessions/ ...            # subfolder when pressure demands
    users/
```

- Naming: kebab-case files, `<feature>.routes|service|repository|errors|module`. Worker composition is explicit in `app.ts` (no container).
- `cfkit scaffold feature <name>` emits a slice that already satisfies every gate; `cfkit remove feature <name>` unwires it.

### 5.10 Verification and testing

- `vitest-pool-workers` + Miniflare for D1/KV/R2/Queues/DO local simulation; no other test runner.
- Test tiers: unit (pure functions/policies), worker-integration (routes + bindings in-pool), contract tests (dialect invariants + parity manifest vs snapshot), optional e2e against a deployed dev environment.
- Verify profiles via `cfkit` (family model): `fast` (format, lint, typecheck, unit+integration, contract check, budget checks), `full` (adds build/dry-run deploy, coverage, dupes/smells), `runtime` (deployed dev smoke + evidence), `ci` (full + runtime as risk requires).
- **Budget checks** (the free-tier guardrails): KV write allowlist, cron-count check, crypto algorithm allowlist, `env.*` access confinement, bundle-size budget, "no `new Date()` in services" lint, per-endpoint declared write/subrequest budget review.
- Coverage thresholds set explicitly once the surface stabilizes; CI mirrors the family (risk classification → verify → runtime when needed).

### 5.11 Delivery, CI, and operations

- Build: wrangler bundling (esbuild); deploy unit = one Worker + bindings per environment; `wrangler deploy --env <env>`; versions/rollback via wrangler deployments.
- CI (GitHub Actions): install → verify:fast → verify:full → conditional runtime; deploy to `staging` on main, `prod` on tag, both gated by verify and explicit authorization (family handoff model).
- Observability: Workers Logs + request-id echo + `traceId` in problems; optional Tail Worker/OTLP hook documented but off by default.
- Rollback: previous Worker version; **D1 migrations must be backward-compatible for one deploy cycle** (expand → migrate → contract), since schema and code don't roll back atomically.
- Failure modes to document: 1027 (daily request cap) behavior per route (fail-open vs fail-closed choice), 1102 (CPU) monitoring, D1 write-limit exhaustion, queue 24h expiry.

### 5.12 Harness — `cfkit`

Family-parity CLI, phased:

- **M1**: `verify --profile`, `scaffold feature`, `remove feature`, `budget:check`, `contract:check`, `doctor`.
- **M2+**: task lifecycle (`task begin/verify`), risk classification, handoff (commit/push/draft-PR with explicit per-action authorization), evidence binding — same model as `backendkit`/`frontendkit`.

## 6. Free-Tier Conformance Rules

Derived from the budget; these become `docs/standards/free-tier-budget.md` on acceptance:

1. **Request efficiency**: public GETs are CDN-cacheable by default (`s-maxage` policy classes); personalized routes are lean; health checks are not polled aggressively.
2. **Write amplification**: ≤ 2–3 rows written per API write request (indexes included); batch writes; deletes count as writes.
3. **KV is read-only**: writes only via allowlisted maintenance paths (config publishing), never per request.
4. **Durability via D1/DO only**: no KV, no queue, no cache may be a source of truth.
5. **CPU diet**: crypto allowlist (Ed25519/ES256 first-party; RS256 verify allowed for OIDC ID tokens, no RSA signing), zod 4.5+, lazy per-route imports, no heavyweight deps; bundle-size budget in CI.
6. **Subrequest discipline**: ≤ 10 subrequests per request by design (50 hard cap).
7. **Cron economy**: at most one cron trigger per project; the account's 5-trigger budget is shared.
8. **DO economy**: hibernation-first; no always-on objects; ≤ 1 DO request per auth operation.
9. **Log economy**: structured, redacted, sampled where noisy; 200k events/day ceiling.
10. **Budget awareness is measured**: deployed dev environment records CPU/writes per route class as runtime evidence for medium/high-risk changes.

## 7. Material Risks And Tradeoffs

| Risk                                                      | Impact                                                              | Mitigation / decision                                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 10ms CPU proximity on auth flows                          | Intermittent 1102 errors under load                                 | CPU diet rules; per-route lazy loading; measure in dev with evidence; profile with DevTools CPU tool             |
| Contract subset: password ops descoped                    | Downstream kits/UI referencing `auth.password.*` find no operations | Descope declared in parity manifest + ADR; per-project frontend/mobile skip password UI; dialect stays identical |
| DO CPU ambiguity on free                                  | No v1 impact (password descoped)                                    | Deferred to backlog with the password item; the M0 spike remains the gate if revived                             |
| D1 write budget (100k/day) + index amplification          | Write-path failures past budget                                     | §6 rules 2/4; TTL sweeps via cron; telemetry for rows written per request                                        |
| Account-wide 100k requests/day shared with other projects | Unpredictable exhaustion                                            | Cache-first design; document per-account sizing; separate accounts for unrelated projects                        |
| PBKDF2 100k cap below OWASP                               | Constrains any inline password fallback                             | Backlog concern only; Argon2 (WASM) is the revival path — never weak KDF params                                  |
| Queues 24h retention + ops cost                           | Long/failed jobs expire; retries cost ops                           | Fast idempotent handlers; small payloads; DLQ discipline; Workflows for sagas only                               |
| Cloudflare limits/pricing change                          | Budget standard goes stale                                          | Budget standard is versioned and re-verified on platform changes (family escalation rule)                        |
| zod CPU/memory cost                                       | CPU/instability on free                                             | zod ≥4.5 (memory), schema reuse, hot paths measured; hand-rolled validation only with evidence                   |

## 8. Acceptance Criteria

v1 is accepted when all hold **on the free plan**:

1. A deployment serves the implemented contract surface with dialect invariants verified by contract tests: envelope, RFC7807 (`code` + `traceId`), `X-Request-Id` echo, 204 semantics, validation error shape.
2. Parity manifest check passes in CI; implemented surface matches the snapshot; password operations recorded under `descoped` with the ADR; downstream kits can retarget via provenance swap.
3. `verify:fast` and `verify:full` green locally and in CI; budget checks (KV writes, crypto allowlist, env confinement, cron count, bundle size) green.
4. Auth flows (OIDC, sessions/refresh, JWT/JWKS) verified with runtime evidence including measured CPU per invocation within budget.
5. Auth scope verified: no password material stored anywhere; descope documented (ADR + manifest + docs backlog); OIDC is the sole sign-in method.
6. `cfkit scaffold feature` output passes all gates on first run; `remove feature` unwires cleanly.
7. Docs baseline present: `AGENTS.md`, `docs/README.md`, standards (contract, budget, code quality), ADRs for stack, data plane, auth scope, and budget guardrails; `_WIP/` reports excluded from version control except explicit keep requests.

## 9. Decisions Log

All questions from r2 review are resolved (2026-10-10):

1. **Backlog method ordering** — magic link first, then password revival; passkeys third. **Family scope** — methods land cf-first as contract supersets; family adoption decided separately.
2. **Rate limiting placement** — DO memory-first counters for auth paths in v1; generic rate limiting deferred; evaluate Cloudflare's native rate-limiting binding as a future swap.
3. **Harness phasing** — M1 tools (`verify`, `scaffold`, `budget:check`, `contract:check`, `doctor`); task lifecycle and handoff at M2+.
4. **Feature coverage order** — core surface first (auth/users/sessions → background → admin → merchant-onboarding); password excluded (descoped).
5. **Workflows** — deferred until a concrete multi-step flow exists.

## 10. Milestones

| Milestone                               | Content                                                                                                                                                                                                                                                  | Exit criteria                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **M1 — Skeleton + core + gates**        | Repo, wrangler envs, Hono pipeline (request-id/envelope/problem/validation), config, errors, clock, logging, contract generation + parity manifest (with descope), cfkit (verify/scaffold/budget), docs skeleton + first ADRs (incl. auth scope descope) | Deployed dev worker; verify:fast green; scaffold output passes gates; budget standard drafted |
| **M2 — Auth (OIDC + sessions + users)** | OIDC flows, sessions/refresh in D1, JWT/JWKS, users/me; runtime evidence                                                                                                                                                                                 | Acceptance criteria 1–5 for the auth/users surface                                            |
| **M3 — Background processing**          | Queues producer/consumer, job contracts, cron sweeps, DLQ policy; email module only when a feature needs it                                                                                                                                              | Job idempotency + retention behavior verified; budget checks include queue ops                |
| **M4 — Remaining parity**               | admin, merchant-onboarding, manifest leftovers (password ops excluded — descoped)                                                                                                                                                                        | Manifest `pending` empty or explicitly descoped                                               |

**Backlog (ordered)**: magic link (with the email module) → password revival (M0 spike → `CredentialHasher` + WASM Argon2id adapters) → passkeys; Workflows deferred until a concrete multi-step flow exists.

## 11. References

- Family repos: `~/workspace/devs/core/backend-core-kit` (contract owner, ADRs, harness model), `frontend-core-kit` (contract sync/provenance), `mobile-core-kit` (optional-usecase rule, core-first philosophy)
- Cloudflare: [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) · [Workers Pricing (D1/KV/Queues/DO/R2/Workflows/Hyperdrive)](https://developers.cloudflare.com/workers/platform/pricing/) · [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- PBKDF2 cap: [community thread (2026)](https://community.cloudflare.com/t/pbkdf2-iteration-limit-on-workers-free/965725) · [community thread (2025)](https://community.cloudflare.com/t/configure-pbkdf2-iteration-cap/848334) · [workerd PR #1471](https://github.com/cloudflare/workerd/pull/1471)
- Backlog auth precedent: [BlockchainCommons/passkey-cloudflare](https://github.com/BlockchainCommons/passkey-cloudflare) · [SimpleWebAuthn](https://simplewebauthn.dev/docs/advanced/passkeys/) · OWASP [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
