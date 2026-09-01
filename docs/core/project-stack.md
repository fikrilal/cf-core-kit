# Project Stack

Decided 2026-10-10 and recorded per-topic in `docs/adr/`. Changing a decision requires a superseding ADR.

- **Runtime**: Cloudflare Workers — one script per deployment (fetch / queue / scheduled / DO classes). See ADR-0001.
- **Language / tooling**: TypeScript strict; Node >= 22 pinned via `.nvmrc`; npm.
- **HTTP**: Hono with a fixed middleware pipeline; zod (>= 4.5) for runtime validation and schemas. See ADR-0003.
- **Contract**: generated `docs/openapi/openapi.yaml` (committed) + Spectral lint; parity manifest `tools/parity/coverage.json` (implemented / pending / descoped). See ADR-0002.
- **Data**: D1 + Drizzle; drizzle-kit generates migrations applied via `wrangler d1 migrations`. See ADR-0004.
- **Background**: Cloudflare Queues for jobs; one fan-out cron; DO memory-first counters. See ADR-0007.
- **Cache**: in-isolate memoizer first; KV for cold-start reads only, never on write paths. See ADR-0005, ADR-0007.
- **Objects**: R2 with presigned direct transfers. See ADR-0007.
- **Auth**: OIDC sign-in; sessions (opaque rotating refresh tokens) in D1; Ed25519 access JWT + JWKS. No password material — `auth.password.*` descoped. See ADR-0006.
- **Crypto**: WebCrypto only — Ed25519/ES256 sign+verify; RS256 verification for OIDC ID tokens; no RSA signing. See ADR-0008.
- **IDs**: UUIDv7-style sortable IDs generated in application code.
- **Time**: injected `Clock`; no wall-clock reads in services. See ADR-0008.
- **Observability**: Workers Logs + `X-Request-Id` / `traceId` propagation; OTLP export is an optional hook, off by default. See ADR-0005.
- **Testing**: `vitest` with `@cloudflare/vitest-plugin` — tests run inside the Workers runtime via Miniflare (D1/KV/R2/Queues/DO simulated).
- **Lint / format**: eslint flat config, type-aware, strict baseline (import hygiene, size budgets, `no-console`) per ADR-0011 + Prettier; budget checks join the gate per ADR-0008.
- **CLI**: `tools/cfkit` — scaffold / remove / verify profiles / budget:check / contract:check / doctor (M1). See ADR-0009.
- **Delivery**: wrangler environments dev/staging/prod; version-based rollback; expand → migrate → contract schema safety. See ADR-0010.

Alternatives considered for each slot are recorded in the ADRs and in `_WIP/2026-10-10_cf-core-kit-architecture-proposal.md`.
