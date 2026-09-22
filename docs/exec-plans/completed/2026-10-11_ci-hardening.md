# CI workflow hardening: SHA pins and least privilege

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0010 (deployment environments and rollback); roadmap Phase 6 follow-up

## Objective

The existing `.github/workflows/ci.yml` (checkout/setup-node at floating tags, no permissions
block) is hardened: every action pinned to a 40-hex commit SHA, `permissions: contents: read`,
concurrency cancelling superseded runs, an explicit dev-dependency install, and a committed
meta-test that fails when any of those properties regress.

## Behavior reference

backend-core-kit's `profile-parity.spec.ts` pins its workflow invariants: CI must call the
verify alias, and every `uses:` must be a 40-hex SHA. Same idea here, as a node:test fixture
over the workflow text.

## Design

- SHAs are taken from the actions' released tags via the GitHub API (lightweight tags whose
  object type is `commit`), recorded with the tag in a comment on the `uses:` line so updates
  are mechanical.
- `scripts/ci/workflow.test.mjs` asserts: every `uses:` line matches
  `uses: <owner>/<repo>@<40-hex> # <tag>`; the workflow declares `permissions:` with
  `contents: read` and nothing broader; `npm run verify:ci` is the verify step; concurrency is
  configured. The test reads the workflow text — no network.
- `npm ci --include=dev` is explicit: a `NODE_ENV=production` environment (which bit this
  workspace during Phase 5) must not silently skip devDependencies in CI.

## Acceptance Criteria

1. Workflow: pinned SHAs (with tag comments), `permissions: contents: read`, concurrency,
   `npm ci --include=dev`, `npm run verify:ci`.
2. The meta-test fails when a pin is floated or the permissions block is widened (probe by
   mutation, recorded).
3. `verify:ci` green.

## Steps

- [x] Harden the workflow + meta-test (+ fixtures)

## Verification

```bash
node --test scripts/ci/workflow.test.mjs   # 3 tests: 40-hex pins with tag comments, contents:read
                                           # only, npm ci --include=dev + npm run verify:ci +
                                           # concurrency
# probes: floating the checkout pin fails the pin test; changing contents:read to write fails
#   the permissions test; restored -> green
npm run verify:ci                          # ci profile green (workflow runs it in GitHub Actions)
- [x] Probe mutations + verify + bookkeeping

## Decision Log

- 2026-10-11: SHA pinning with the tag in a comment. -> updates stay reviewable while the pin stays immutable
- 2026-10-11: invariants enforced by a committed test, not reviewer memory. -> ADR-0011 gate honesty
```
