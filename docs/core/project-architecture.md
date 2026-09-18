# Project Architecture

cf-core-kit is a single Worker per deployment — HTTP API, queue consumer, cron, and Durable Object classes in one script — that serves the wire contract owned by `backend-core-kit`. Existing clients (frontend-core-kit, mobile-core-kit) observe the same envelopes, problem details, headers, error codes, and token semantics; the Cloudflare implementation is not visible to them.

## Principles

- **Contract parity first.** The pinned backend snapshot is the contract; this kit follows it, never leads. Implemented operations are machine-checked; password operations are descoped for v1 (ADR-0002, ADR-0006).
- **The core module is the product.** Request IDs, envelope, problem details, validation, idempotency, auth, config, logging, DB, queue, storage, and caching live in `src/platform` and are never re-implemented per feature.
- **Progressive feature architecture.** Start with the smallest feature shape that fits and promote only on explicit triggers (ADR-0001).
- **Budgets are architecture.** Free-tier limits (ADR-0005) decide where state, jobs, and coordination live (ADR-0007).
- **One composition root.** `src/app.ts` wires middleware and features; `src/worker.ts` exports handlers. No DI container, no reflection.
- **Transport is not domain.** Features return typed data and typed errors; platform helpers render envelopes and problem details.

## Repository Layout

```text
cf-core-kit/
├─ src/
│  ├─ worker.ts              # fetch / queue / scheduled handlers + DO class exports
│  ├─ app.ts                 # composition root (middleware + feature mounting)
│  ├─ jobs.ts                # job registry + scheduled fan-out composition
│  ├─ platform/              # cross-cutting concerns; never imports features
│  │  ├─ config/             # zod-validated env; raw env access stays inside src/platform
│  │  ├─ http/               # envelope, problem details, request id, validation, idempotency, list query
│  │  ├─ auth/               # signing keyring, access-token issue/verify, principal guard
│  │  ├─ rate-limit/         # DO-backed rate limiting (AuthRateLimiter + middleware)
│  │  ├─ db/                 # D1 client + Drizzle schema root; batch/transaction helpers
│  │  ├─ cache/              # in-isolate memoizer; CDN caching policy helpers
│  │  ├─ queue/              # producer/consumer helpers, job envelope, retry defaults (Phase 4)
│  │  ├─ storage/            # R2 presign
│  │  ├─ email/              # Resend adapter behind a port (lands with email-dependent features)
│  │  ├─ push/               # FCM adapter behind a port (optional)
│  │  ├─ logging/            # structured logs + redaction
│  │  ├─ clock/              # Clock interface + SystemClock
│  │  ├─ errors/             # ErrorCode enum, AppErrorCode union, problem mapping
│  │  ├─ crypto/             # WebCrypto primitives (Ed25519/RS256 verify, SHA-256, tokens)
│  │  └─ ids/                # UUIDv7-style sortable IDs
│  ├─ features/              # vertical slices (progressive tiers)
│  └─ shared/                # framework-free: error codes, list-query, time
├─ test/                     # integration / contract suites (co-located unit tests live with source)
├─ tools/
│  ├─ cfkit/                 # scaffold / remove / verify / budget / contract CLI (M1)
│  └─ parity/                # coverage.json parity manifest + checker scripts
├─ docs/                     # standards, ADRs, exec plans
└─ _WIP/                     # proposals (historical, not source of truth)
```

## Process Model

```text
Client ──► Cloudflare edge (CDN cache when eligible)
              │
              ▼
        Worker (single script, one deploy unit)
        ├── fetch handler ........ HTTP API (Hono + middleware pipeline)
        ├── queue handler ........ background job consumer
        ├── scheduled handler .... one fan-out cron per project
        └── DO classes ........... AuthRateLimiter (rate-limit counters); future CredentialKeeper
Bindings ─────── D1 · KV (read cache) · R2 · Queues · Durable Objects
External ─────── OIDC providers (v1 auth) · Resend (email, deferred) · FCM (push, optional)
```

- Middleware order is fixed: request-id → logging → per-route gates (rate limit → auth → idempotency) → handler → envelope/problem.
- Requests and subrequests are budgeted per ADR-0005; new routes declare their write/subrequest profile.

## Feature Tiers

Use the smallest tier that fits the behavior (ADR-0001).

| Tier             | Use when                                                                         | Typical shape                                                              |
| ---------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Endpoint slice   | Simple CRUD, settings, reads/lists, one repository                               | routes, optional service, repository, optional errors, colocated tests     |
| Capability slice | Multiple related endpoints share behavior, policies, or persistence              | capability folders under the feature with a shared repository/errors layer |
| Clean slice      | Auth, deletion, queue workflows, transaction-heavy invariants, multiple adapters | explicit `app/` / `infra/` structure                                       |

### Optional use cases

A service exists only when the operation has logic worth isolating: a final validation gate, multi-step orchestration, or a business rule worth its own test. Never a pure pass-through — the handler calls the repository directly instead.

## Conventions

### Errors and results

- Expected business outcomes are typed results (`kind` discriminants), so handlers branch explicitly.
- Unexpected failures are typed errors carrying status + stable code (+ issues, retry-after); one central mapper renders RFC7807. Features never serialize errors.
- Error codes are typed constants unioned into the app-wide `AppErrorCode`; raw production code strings are not accepted by constructors.

### Composition and wiring

- `src/app.ts` is the composition root; features receive typed dependencies, never bindings.
- No `env.*` access outside `src/platform/config` and platform modules (lint-enforced).

### Request flow

```text
HTTP request
  → middleware: request id → logging → (rate limit if opted in) → (auth | public) → (idempotency if opted in)
  → Hono route
  → handler: decode + validate → [service] → repository (Drizzle) → D1
  → envelope / list / created / no-content helpers
  → central problem mapper renders failures
side effects: enqueue job → queue consumer → notifications / sweeps
```

## Boundaries (enforced)

Executable rules, not review memory (ADR-0008):

- `src/platform/**` must not import `src/features/**`;
- `src/features/**` must not import `src/worker.ts` or app entry modules;
- cross-feature imports only through a feature's `index.ts`, allowlisted per pair;
- `src/shared/**` stays framework-free;
- raw `env.*` only in `src/platform/**` (plus the single handoff in `src/app.ts`);
- KV writes only in allowlisted maintenance paths;
- crypto allowlist: Ed25519/ES256, RS256 verify for OIDC ID tokens; no RSA signing;
- no `new Date()` / `Date.now()` in service/domain code — injected `Clock`;
- features never construct raw data responses.

## Data Layer

- D1 is the engine; Drizzle is the query layer; migrations are committed and applied via `wrangler d1 migrations` (ADR-0004).
- Write discipline: ≤ 2–3 rows written per API write request (indexes included); indexes only for proven read patterns.
- Multi-statement atomic writes use `batch()` or single statements — D1 has no interactive transactions across awaits.
- Sessions, idempotency records, and user data live in D1 with TTL sweeps via the fan-out cron.

## Auth Model

- v1 is OIDC-first: OIDC sign-in → principal → session issuance; no password material is stored anywhere (ADR-0006).
- Access tokens are Ed25519 (EdDSA) with a JWKS endpoint; refresh tokens are opaque, rotated on every refresh, with reuse detection.
- Auth endpoints are rate-limited per client address by the memory-first `AuthRateLimiter` Durable Object (ADR-0012); exceeding a window returns `429` with `Retry-After` (a platform-safety response, intentionally undeclared in `x-error-codes`).
- `auth.password.*` operations are descoped and recorded in the parity manifest; backlog order is magic link → password revival (M0-spike gated) → passkeys.

## Contract Parity Model

1. Route definitions generate `docs/openapi/openapi.yaml` in backend-core-kit's artifact shape, linted with Spectral.
2. `tools/parity/coverage.json` tracks `implemented` (allowlist), `pending`, and `descoped` operations; CI fails on drift.
3. Contract tests assert dialect invariants on live responses (envelope, RFC7807, `X-Request-Id` echo, 204 semantics, validation shape).
4. Downstream kits retarget by swapping `provenance.json` in their contract sync.

## Pointers

- Stack decisions: `docs/core/project-stack.md`
- Decision log: `docs/adr/README.md`
- Standards index: `docs/standards/README.md` — the free-tier guardrails are enforced today by `npm run budget:check`; the standard doc is queued with the usage envelopes
- Proposals (historical): `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`
