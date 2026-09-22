# CI/CD (normative)

Status: normative (landed 2026-10-11). The pipeline exists; these are its invariants.

## The pipeline

- One workflow (`.github/workflows/ci.yml`) runs on push and pull requests and executes exactly
  `npm run verify:ci` — the `ci` verify profile (fast steps + coverage + duplication + build +
  the runtime boot smoke + the scaffold smoke). CI does not run a hand-picked subset.
- Actions are **pinned to 40-hex commit SHAs** with the released tag in a comment; the workflow
  declares least-privilege `permissions` (`contents: read` only) and cancels superseded runs.
  `scripts/ci/workflow.test.mjs` fails when a pin floats or a permission widens.
- Dependencies install with `npm ci --include=dev` — an environment that sets
  `NODE_ENV=production` must not silently skip devDependencies (this workspace hit exactly that
  during Phase 5).
- CI must never: receive secrets beyond the checkout token, publish or deploy anything, or
  weaken a gate to go green. Gate changes land in the owning script with fixtures and a recorded
  probe, per the testing-strategy standard.

## Profiles and lanes

- Profiles: `fast` (developer loop), `full` (fast + coverage + duplication + build), `runtime`
  (boot smoke), `smoke` (scaffold cycle), `ci` (full + runtime + smoke). Step ids are stable and
  pinned by `tools/cfkit/cfkit.test.ts`; advisory duration budgets warn without failing.
- Deployment is manual and credentialed (ADR-0010): `npm run deploy` targets `dev`;
  `wrangler deploy --env staging|prod` targets the other lanes, each with its own Worker name,
  D1 database, queues, and secrets. The first-deploy runbook lives in `README.md`.
- Local verification precedes pushes: `npm run verify` for the loop, `npm run verify:ci` before
  publishing. Credentialed evidence lanes (dashboard CPU, live R2 upload, first deploy) are
  tracked in their task plans, never simulated in CI.
