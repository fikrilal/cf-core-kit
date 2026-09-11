# Emit the OpenAPI snapshot from route definitions (task 2.2)

- Status: completed
- Owner: fikrilal
- Risk: high
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0003 (zod-openapi contract pipeline; committed artifact + drift gate), ADR-0002 (artifact shape parity); roadmap task 2.2

## Objective

`docs/openapi/openapi.yaml` becomes a generated artifact: route definitions carry zod schemas via an openapi-enabled Hono layer, an emitter writes the committed YAML, and the gate re-emits into a temp file and byte-compares (drift fails). The emitted operations for the implemented surface (`health.get`, `ready.get`) must match the pinned backend snapshot's shape for those operations: dotted operationIds, `Health` tag, summary/description, 200 schema `{ type: object, properties: { status: { type: string, example: ok } }, required: [status] }`, `x-error-codes: [INTERNAL]`, `servers: [{ url: / }]`.

## Constraints and verified facts

- Dependencies (versions verified): `@hono/zod-openapi@^1.6.3` (peers `zod ^4.0.0` and `hono >=4.10.0` — ours: zod 4.6.5, hono 4.13.13) and `yaml@^2.9.1` (the same YAML library backend-core-kit uses for its snapshot).
- The app becomes an `OpenAPIHono` (extends Hono; existing middleware and `send()` test helper unaffected in behavior). Health routes move to `createRoute` definitions; a typed **operation registry** (`operationId`, path, method, error codes, route, handler) is the single source that (a) registers routes on the app, (b) attaches `x-error-codes` in the emitted document (custom extensions are attached by the builder from the registry, not hand-written into routes), and (c) gives later tasks (2.3, 2.4) a machine-readable inventory.
- Emitter bridge (verified need): Node's native type stripping cannot resolve extensionless relative imports (`ERR_MODULE_NOT_FOUND` confirmed), and the kit will not churn `src/` import style for tooling. Bridge: `scripts/contract/emit.mjs` bundles `tools/contract/emit.entry.ts` with esbuild (new explicit devDependency; already present transitively) into a temp ESM file, imports it, and writes YAML. `emit.entry.ts` exports `renderOpenApiYaml(): Promise<string>` — pure, no bindings, importable by the bundler.
- Determinism is a hard requirement: no timestamps or environment-dependent fields in the document; the drift check is a byte comparison. A fixture proves two emits are byte-identical.
- Emit/gate split: `npm run contract:emit` writes the committed artifact (developer action); `npm run contract:check` re-emits to a temp path and byte-compares (never mutates the tree) — the gate extension lives in `scripts/contract/check.mjs`.
- `info`: title `CF Core Kit API`, version from package.json; no `securitySchemes`/`components` until the surface needs them (health/ready are inline in backend too).
- Wiring: fast profile + cfkit fixture step lists already include `contract:check` (from 2.1); `contract:emit` is a developer script only.
- Gate honesty: hand-editing the committed spec must fail (`contract:check`), and a schema change in a route definition must fail until re-emitted (probe both).

## Impact Areas

- API / contract: yes — the emitted snapshot is the artifact downstream consumers read
- Budget / free-tier footprint: yes — `@hono/zod-openapi` lands in the worker bundle; bundle budget re-checked (834 KiB vs 2048 KiB headroom)
- CI / release: yes (`contract:check` re-emits; CI inherits via profile)
- Docs: yes (docs/README contract section; AGENTS map gains `tools/contract/`)

## Acceptance Criteria

1. `npm run contract:emit` writes `docs/openapi/openapi.yaml`; two consecutive emits are byte-identical; the document passes the 2.5 lint once it lands.
2. `health.get` / `ready.get` in the emitted spec match the pinned snapshot's operations (fields compared by the 2.3 checker once it lands; at minimum: operationId, tags, summary/description, 200 schema, x-error-codes, servers).
3. `npm run contract:check` passes on the committed spec; a hand-edited spec fails with a named violation; a route-definition change fails until re-emitted (live probes).
4. Existing suite stays green after the OpenAPIHono refactor (spec adjustments allowed where they assert internals, behavior unchanged); `npm run verify` green with the bundle budget intact.

## Steps

- [x] Add dependencies; refactor app + health routes to OpenAPIHono/createRoute with the registry
- [x] `tools/contract/emit.entry.ts` + `scripts/contract/emit.mjs` (esbuild bridge) + npm scripts
- [x] Drift check extension in `scripts/contract/check.mjs` + fixtures (byte compare, determinism)
- [x] Emit the committed artifact; live probes (hand-edit fails, route change fails); verify + bookkeeping

## Decision Log

- 2026-10-11: custom extensions (`x-error-codes`) are attached by the builder from the typed registry instead of hand-writing extension objects into routes. -> one source of truth for metadata; registry doubles as the parity inventory
- 2026-10-11: emitter bridge is an esbuild bundle step, not tsx or import-style churn. -> esbuild already ships transitively, resolves the real import graph, and keeps `src/` idiomatic
- 2026-10-11: `contract:emit` (write) is separate from `contract:check` (temp emit + compare). -> the gate never mutates the tree; regeneration stays an explicit developer action

## Verification

Exact commands and outcomes:

```bash
npm run verify          # fast profile green; bundle 918.86 KiB / 2048 KiB (was 834.51)
npm run contract:emit   # docs/openapi/openapi.yaml (1254 bytes)
# determinism: two consecutive emits -> identical sha256 3d595c87a73b033a...
node scripts/contract/check.mjs   # "emitted snapshot: up to date" (exit 0, ~0.25s)
# probe A: appended a byte to the committed spec -> [emit] stale; re-emit restored (exit 0)
# probe B: route description mutated in health.ts -> [emit] stale; revert restored (exit 0)
npm run test            # 147 tests green after the OpenAPIHono refactor
npm run test:scripts    # 34 fixtures (4 new emit-drift fixtures)
```

## Completion Notes

`@hono/zod-openapi@1.6.3` (runtime) plus `yaml` and `esbuild` (dev) landed; `createApp()` now returns `OpenAPIHono` and health routes are `createRoute` definitions with typed handlers (`statusSchema` uses `z.string().meta({ example: "ok" })`, reproducing the backend's inline 200 schema exactly). `healthOperations` metadata (path/method/operationId/errorCodes) drives `applyErrorCodeExtensions`, which hard-fails on missing operations or operationId mismatches. The emitter bundles `tools/contract/emit.entry.ts` with esbuild (packages external, bundle written under `node_modules/.cache` so Node resolves externals) and writes YAML via the same `yaml` library backend-core-kit uses; `contract:check` re-emits and byte-compares without touching the tree. En route fixes: CJS `yaml` cannot be bundled into ESM (packages are external now); the temp bundle must live inside the repo for resolution; `.prettierignore` covers the emitted spec; `tools/contract` joined the root tsconfig and the AGENTS map.

## Follow-ups

- [ ] Phase 3 adds auth/users operations to the registry; the emitted spec grows with the surface
