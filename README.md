# CF Core Kit

Production-grade Cloudflare Workers backend template — the Cloudflare member of the core-kit family. It serves the same wire contract as `backend-core-kit` for the implemented surface (envelope, RFC7807 problem details, stable error codes, `X-Request-Id`, session tokens with JWKS), so existing frontend-core-kit and mobile-core-kit clients need no tuning for the implemented operations.

- **Free-tier engineered**: one Worker script with D1, Queues, KV, R2, and Durable Objects; the free-tier budget is a normative standard (ADR-0005).
- **OIDC-first auth**: no password material anywhere; `auth.password.*` is descoped for v1 and tracked in the parity manifest (ADR-0006).
- **Lean by default**: Hono + zod, Drizzle, strict TypeScript, no ORM magic, no DI container.

Status: platform core complete; the contract pipeline is next. Decisions are recorded in `docs/adr/`; proposals live in `_WIP/`.

## Requirements

- Node — pinned by `.nvmrc` (`22.22.0`)
- npm

## Commands

- `npm run verify` — the single gate (format, lint, typecheck, tests, budget and drift checks); `npm run verify:ci` adds the dry-run build
- `npm run dev` — local Worker via wrangler (real workerd, local D1)
- `npm run deploy` — deploy the dev environment (`wrangler deploy --env staging|prod` for the others)
- `npm run format` — format the tree

## Deploy

Deploys target wrangler environments (`dev`, `staging`, `prod` — ADR-0010), each with its own Worker name, vars, and D1 database. The database ids in `wrangler.jsonc` are placeholder zero-UUIDs until you create the databases.

First deploy (dev):

1. `npx wrangler login`
2. `npx wrangler d1 create cf-core-kit-dev` — paste the returned id into `wrangler.jsonc` (top-level and `env.dev`); repeat with `cf-core-kit-staging` / `cf-core-kit-prod` when those lanes go live
3. `npx wrangler d1 migrations apply cf-core-kit-dev --remote`
4. `npm run deploy`
5. Smoke: `curl -fsS https://cf-core-kit-dev.<subdomain>.workers.dev/health` and `/ready` (both `{"status":"ok"}`); every response echoes `X-Request-Id`
6. Budget evidence: after real traffic, read CPU time per route class in the Workers dashboard (Metrics); keep invocation CPU under the 10 ms free-tier budget (ADR-0005)

Secrets: `npx wrangler secret put NAME --env dev`; local secrets live in `.dev.vars` (never committed).

## Pointers

- Docs index: `docs/README.md`
- Architecture: `docs/core/project-architecture.md`
- Stack: `docs/core/project-stack.md`
- ADRs: `docs/adr/README.md`
