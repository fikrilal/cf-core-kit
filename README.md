# CF Core Kit

Production-grade Cloudflare Workers backend template — the Cloudflare member of the core-kit family. It serves the same wire contract as `backend-core-kit` for the implemented surface (envelope, RFC7807 problem details, stable error codes, `X-Request-Id`, session tokens with JWKS), so existing frontend-core-kit and mobile-core-kit clients need no tuning for the implemented operations.

- **Free-tier engineered**: one Worker script with D1, Queues, KV, R2, and Durable Objects; the free-tier budget is a normative standard (ADR-0005).
- **OIDC-first auth**: no password material anywhere; `auth.password.*` is descoped for v1 and tracked in the parity manifest (ADR-0006).
- **Lean by default**: Hono + zod, Drizzle, strict TypeScript, no ORM magic, no DI container.

Status: foundation in progress. Decisions are recorded in `docs/adr/`; proposals live in `_WIP/`.

## Requirements

- Node — pinned by `.nvmrc` (`22.22.0`)
- npm

## Commands

- `npm run verify` — format check, lint, typecheck, tests, dry-run build (the single gate; CI mirrors it)
- `npm run dev` — local Worker via wrangler
- `npm run deploy` — deploy with wrangler (environments land with the deployment phase)
- `npm run format` — format the tree

## Pointers

- Docs index: `docs/README.md`
- Architecture: `docs/core/project-architecture.md`
- Stack: `docs/core/project-stack.md`
- ADRs: `docs/adr/README.md`
