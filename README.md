# CF Core Kit

Production-grade Cloudflare Workers backend template — the Cloudflare member of the core-kit family. It serves the same wire contract as `backend-core-kit` for the implemented surface (envelope, RFC7807 problem details, stable error codes, `X-Request-Id`, session tokens with JWKS), so existing frontend-core-kit and mobile-core-kit clients need no tuning for the implemented operations.

- **Free-tier engineered**: one Worker script with D1, Queues, and a memory-first Durable Object limiter; R2 presigning needs no binding. The free-tier budget is a normative standard (ADR-0005).
- **OIDC-first auth**: no password material anywhere; `auth.password.*` is descoped for v1 and tracked in the parity manifest (ADR-0006).
- **Lean by default**: Hono + zod, Drizzle, strict TypeScript, no ORM magic, no DI container.

Status: Phases 0-5 complete — platform core, the contract pipeline, the OIDC-first auth surface, background processing (queue platform, cron sweeps, R2 presigning), and the cfkit harness (scaffold/remove, five verify profiles, task lifecycle, handoff approvals). Remaining work is product-deferred (`admin`, `merchant-onboarding` surfaces) or credentialed (live deploy evidence), tracked in `docs/exec-plans/roadmap.md`. Decisions are recorded in `docs/adr/`; proposals live in `_WIP/`.

## Requirements

- Node — pinned by `.nvmrc` (`22.22.0`)
- npm

## Commands

- `npm run verify` — the fast developer gate (format, lint, typecheck, tests, script fixtures, budget, secrets scan, drift, contract checks)
- `npm run verify:ci` — the ci profile: the same steps plus coverage floors, the duplication gate, the dry-run build, the runtime boot smoke, and the scaffold smoke (what CI runs)
- `npm run dev` — local Worker via wrangler (real workerd, local D1)
- `npm run deploy` — deploy the dev environment (`wrangler deploy --env staging|prod` for the others)
- `npm run format` — format the tree
- `npm run cfkit -- scaffold feature <name>` / `scaffold endpoint <operationId>` — generate a slice or implement a pending pinned operation (see `docs/guide/`)
- `npm run cfkit -- remove feature <name> --yes` / `remove endpoint <operationId>` — the marker-checked inverse
- `npm run cfkit -- task begin --plan <path>` / `task verify` — plan-driven task tracking with bounded repair; `handoff dry-run --action commit|push|draft-pr` prepares an expiring per-action approval

## Deploy

Deploys target wrangler environments (`dev`, `staging`, `prod` — ADR-0010), each with its own Worker name, vars, and D1 database. The database ids in `wrangler.jsonc` are placeholder zero-UUIDs until you create the databases.

First deploy (dev):

1. `npx wrangler login`
2. `npx wrangler d1 create cf-core-kit-dev` — paste the returned id into `wrangler.jsonc` (top-level and `env.dev`); repeat with `cf-core-kit-staging` / `cf-core-kit-prod` when those lanes go live
3. `npx wrangler queues create cf-core-kit-jobs-dev` and `npx wrangler queues create cf-core-kit-dlq-dev` — consumers cannot deploy before their queues exist; repeat per environment (`...-staging`, `...-prod`)
4. `npx wrangler r2 bucket create cf-core-kit-dev` and an R2 API token scoped to that bucket; put the account id and bucket name in `wrangler.jsonc` vars and the token's keys in secrets: `npx wrangler secret put R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (per environment) — presigned URLs are generated from these, the Worker never touches objects
5. `npx wrangler d1 migrations apply cf-core-kit-dev --remote`
6. `npm run deploy`
7. Smoke: `curl -fsS https://cf-core-kit-dev.<subdomain>.workers.dev/health` and `/ready` (both `{"status":"ok"}`); every response echoes `X-Request-Id`
8. Budget evidence: after real traffic, read CPU time per route class in the Workers dashboard (Metrics); keep invocation CPU under the 10 ms free-tier budget (ADR-0005)

Secrets: `npx wrangler secret put NAME --env dev`; local secrets live in `.dev.vars` (never committed).

## Local auth keys

`node scripts/auth/generate-keys.mjs` prints an Ed25519 signing key set (`AUTH_SIGNING_KEYS_JSON` and its base64 form). Put it in `.dev.vars` for local development and set it with `npx wrangler secret put AUTH_SIGNING_KEYS_JSON` for deployed environments (staging/production require it; there is deliberately no ephemeral dev key because Workers isolates rotate). OIDC sign-in additionally needs `AUTH_OIDC_GOOGLE_CLIENT_IDS` (comma-separated).

Key rotation: add the new key at the **front** of the `AUTH_SIGNING_KEYS_JSON` array (it becomes the signer), deploy, keep the previous keys published until every outstanding access token has expired plus the verifier's 60-second clock skew (16 minutes with the default 900-second TTL; scale with `AUTH_ACCESS_TOKEN_TTL_SECONDS`), then remove them. `GET /.well-known/jwks.json` publishes every configured public key with its `kid`.

Auth endpoints are rate-limited per client address by a memory-first Durable Object (ADR-0012): exceeding a window returns `429` with `Retry-After`; counters are not persisted (an eviction resets them) and limiter failures fail open.

## Pointers

- Docs index: `docs/README.md`
- Architecture: `docs/core/project-architecture.md`
- Stack: `docs/core/project-stack.md`
- ADRs: `docs/adr/README.md`
