# Test ergonomics (harness parity B7)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.3 (rows 3.1-3.10; 3.7 moved to A4, 3.11 is B9, 3.12 is B8); ADR-0011 (sensors are not proof)

## Objective

Open batch B by giving the suite the ergonomics the family's harness has: named tiers, a suite contract,
envelope/dialect assertion helpers, an env-isolation guard and coverage reporters with a CI artifact.

## Behaviour reference (backend-core-kit)

Three vitest tiers with separate configs; `SKIP_DEPS_TESTS` gates; callback suite factories
(`describeAuthE2eSuite`); `test/support/stubs.ts` + `test/support/http.ts`; envelope/error assertion
helpers; an env-isolation setup that deletes service variables; a determinism rule preferring an injected
clock; tracked-ID cleanup stacks; no snapshot tests; coverage floors below baseline with `text`, `lcov` and
`json-summary` reporters and a CI artifact.

## Design

- **Tiers** (3.1): `test:unit` (`src` + `test/support`), `test:int` (`test/integration`), `test:contract`
  (`test/contract`); `test` still runs everything. `scripts/tests/tiers.test.mjs` fails if a spec file
  lands outside every tier, and pins the coverage reporters/floors and the artifact step.
- **Suite contract** (3.3): `test/support/suite.ts` — `describeIntegration(name, register)` asserts the
  required bindings (`DB`, `TEST_MIGRATIONS`, `JOBS`) in `beforeAll` with an actionable message and hands
  back `suite.db()` / `suite.clean()`, so table cleanup has one implementation. `missingBindings` and
  `assertIntegrationBindings` are exported for their own fixture.
- **Assertions** (3.5): `test/support/assertions.ts` — `expectData`, `expectDataArray` (validates list
  meta), `expectNoContent`, `expectProblem` (RFC7807 + the `X-Request-Id`/`traceId` echo),
  `expectRateLimited` (429 + truthful `Retry-After` + `RATE_LIMITED`), `expectObjectDeleted` (the key,
  not just the method), `uniqueEmail`, `sessionIdFromToken`.
- **Env isolation** (3.6): `test/support/env-isolation.spec.ts` asserts the ambient pool configures no
  optional service, so every "disabled" path is deterministic.
- **Coverage** (3.10): `lcov` + `json-summary` join `text-summary`; the CI workflow uploads `coverage/`
  with 7-day retention through a commit-pinned action.
- **Not ported, recorded** (3.2, 3.4, 3.8): dependency-tier gating (Miniflare bindings are always
  present), DI/execution-context stubs (seams are injected through dependency objects; handlers are driven
  through HTTP or the job handler), tracked-ID cleanup stacks (per-file isolation; watch item, not built).
- **Already at parity** (3.9): no snapshot tests — recorded in the standard.

## Constraints

- Adoptions must not change behaviour: every refactored assertion keeps its original strictness (the 204
  dialect assertions got _stronger_: they now also pin an empty body and no content type).
- The support helpers ship with their own fixture proving both directions (accepts the dialect, rejects a
  wrong one) — a helper that cannot fail is not a helper.
- The env-isolation spec is a guard, not a mechanism: it fails loudly and tells the reader to remove the
  key from `.dev.vars`, rather than deleting it silently.
- Tier scripts and coverage configuration are pinned by fixtures so they cannot rot silently.

## Acceptance Criteria

1. Three tier scripts plus `test`, and every spec file belongs to at least one tier (fixture).
2. Coverage reporters and floors are pinned, and the CI artifact step is commit-pinned with 7-day
   retention (fixture).
3. The suite contract fails with an actionable message when a binding is missing (spec).
4. Every assertion helper accepts the real dialect and rejects a wrong one (spec).
5. The ambient pool exposes no optional-service config (spec).
6. The helpers are adopted at the loudest duplication sites, with the suite green (67 files / 422 tests).
7. `npm run verify` and `npm run verify:ci` green; four manifest rows flip to `present` (25 of 46).

## Steps

- [x] tiers, suite contract, assertion helpers, env-isolation spec
- [x] helper fixtures (both directions) + tier/reporters/artifact fixture
- [x] adoptions: rate-limits 429, profile-image object deletion, me envelope, session-revoke suite +
      problem + sid claim, email-verification 204s, resend/connect 401s
- [x] coverage reporters + CI artifact (action pinned to a verified SHA) + testing standard update
- [x] `verify`, `verify:ci`, manifest flips, bookkeeping

## Decision Log

- 2026-10-12: `test:unit` includes `test/support`. -> the support specs exercise the helpers under the same
  pool as the suites they serve; leaving them outside every tier is exactly the rot the tier fixture
  forbids.
- 2026-10-12: the suite contract asserts bindings but does not delete ambient config. -> the family deletes
  service env vars in a setup file; asserting absence is stricter (it fails loudly when a developer's
  `.dev.vars` leaks into tests) and keeps the mechanism visible instead of silent.
- 2026-10-12: `expectProblem` checks the `X-Request-Id`/`traceId` echo. -> the request-id contract is a
  hard rule in AGENTS, and it was previously asserted nowhere at the response level.
- 2026-10-12: the coverage artifact action is pinned to `ea165f8d65b6e75b540449e92b4886f43607fa02` (v4),
  resolved from the tag rather than remembered. -> the workflow invariant requires a commit-pinned action;
  a guessed SHA would be a lie the fixture cannot catch.

## Verification

```bash
node --test scripts/tests/tiers.test.mjs        # 4 fixtures: tier scripts, tier coverage, reporters/floors,
                                                # commit-pinned coverage artifact
npx vitest run test/support                     # 27 tests: both directions of every helper + env isolation
npx vitest run src test/support test/integration test/contract
                                                # all tiers: 67 files, 422 tests, green with the adoptions
npm run verify                                  # fast profile green
npm run verify:ci                               # ci profile green (coverage now writes lcov + json-summary)
```

## Completion Notes

Batch B opens with the suite contract, eight assertion helpers and the env-isolation guard, all adopted at
the sites that were re-deriving those shapes inline (the 429 dialect, object deletion, the `me` envelope,
the revocation suite, the 204 sites, the 401 sites). Three non-ports are recorded rather than simulated, and
the suite stayed green through the refactor (67 files / 422 tests). Two smaller choices are recorded above:
`test:unit` owns `test/support` (so no spec can drift outside the tier map), and the coverage artifact action
SHA was resolved from the tag instead of recalled.
