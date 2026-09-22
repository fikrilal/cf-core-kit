# Project Stack

Decided 2026-10-10 and recorded per-topic in `docs/adr/`. Changing a decision requires a superseding ADR.

- **Runtime**: Cloudflare Workers — one script per deployment (fetch / queue / scheduled / DO classes). See ADR-0001.
- **Language / tooling**: TypeScript strict; Node >= 22 pinned via `.nvmrc`; npm; Worker `Env` typed from `wrangler types` (`npm run types`, committed as `worker-configuration.d.ts`).
- **HTTP**: Hono with a fixed middleware pipeline; zod (>= 4.5) for runtime validation and schemas. See ADR-0003.
- **Contract**: generated `docs/openapi/openapi.yaml` (committed) + Spectral lint; parity manifest `tools/parity/coverage.json` (implemented / pending / descoped). See ADR-0002.
- **Data**: D1 + Drizzle; drizzle-kit generates migrations applied via `wrangler d1 migrations`. See ADR-0004.
- **Background**: Cloudflare Queues for jobs; one fan-out cron; DO memory-first rate-limit counters with fail-open behavior (one DO request per auth operation). See ADR-0007, ADR-0012.
- **Cache**: in-isolate memoizer first; KV for cold-start reads only, never on write paths. See ADR-0005, ADR-0007.
- **Objects**: R2 with presigned direct transfers (SigV4 via the pinned `aws4fetch` signer; no Worker binding, the Worker never proxies payloads). See ADR-0007.
- **Auth**: OIDC sign-in; sessions (opaque rotating refresh tokens) in D1; Ed25519 access JWT + JWKS. No password material — `auth.password.*` descoped. See ADR-0006.
- **Crypto**: WebCrypto only — Ed25519/ES256 sign+verify; RS256 verification for OIDC ID tokens; no RSA signing. See ADR-0008.
- **IDs**: opaque string primary keys generated per insert with WebCrypto `randomUUID()`; no coordinated sequences and no sortable-ID scheme (nothing here relies on ID ordering — listings sort by real timestamps).
- **Time**: injected `Clock`; no wall-clock reads in services. See ADR-0008.
- **Observability**: Workers Logs + `X-Request-Id` / `traceId` propagation; OTLP export is an optional hook, off by default. See ADR-0005.
- **Testing**: `vitest` with `@cloudflare/vitest-plugin` — tests run inside the Workers runtime via Miniflare (D1/KV/R2/Queues/DO simulated, queue consumers enabled); script fixtures run under `node:test` via the explicit `test:scripts` list; coverage floors come from the v8 provider through the pool. See the testing-strategy standard.
- **Lint / format**: eslint flat config, type-aware, strict baseline (import hygiene, size budgets, `no-console`) per ADR-0011 + Prettier; the gate set covers budget confinement, the secrets scan, the duplication policy (jscpd with a reviewed allowlist), coverage floors, and the CI workflow invariants per ADR-0008/0011.
- **CLI**: `tools/cfkit` — verify profiles (fast/full/runtime/smoke/ci), scaffold/remove, task lifecycle (`task begin|verify|status`), handoff approvals, `doctor`, and the budget/contract delegates. See ADR-0009.
- **Delivery**: wrangler environments dev/staging/prod; version-based rollback; expand → migrate → contract schema safety. See ADR-0010.

Alternatives considered for each slot are recorded in the ADRs and in `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`.
