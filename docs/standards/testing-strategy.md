# Testing strategy (normative)

Status: normative (landed 2026-10-11). The suite and its gates exist; this pins the rules so
they do not drift.

## Tiers

| Tier              | Location                        | Runtime                                              | Runs in                    |
| ----------------- | ------------------------------- | ---------------------------------------------------- | -------------------------- |
| Source specs      | `src/**/*.spec.ts`              | Workers pool (workerd, real D1/KV/DO bindings)       | `test` step (fast)         |
| Integration specs | `test/**/*.spec.ts`             | Workers pool, composing whole features               | `test` step (fast)         |
| Script fixtures   | explicit list in `test:scripts` | plain Node                                           | `test:scripts` step (fast) |
| Contract suite    | `test/contract/**`              | Workers pool, dialect invariants on the composed app | `test` step                |
| Runtime smoke     | `tools/cfkit/runtime.ts`        | `wrangler dev` on a scratch state directory          | `runtime` profile          |
| Scaffold smoke    | `scripts/scaffold/smoke.mjs`    | live tree, byte-compared restoration                 | `smoke` profile            |
| Coverage          | v8 provider through the pool    | `src/**` minus specs, threshold floors               | `full`/`ci`                |

## Suite and assertion contract

- **Suite contract**: integration suites open with `describeIntegration(name, register)` from
  `test/support/suite.ts`. It asserts the bindings the pool must provide (`DB`, `TEST_MIGRATIONS`,
  `JOBS`) in a `beforeAll`, so a suite run outside the Workers pool fails with a legible message
  instead of a wall of `undefined`, and it hands back `suite.db()` and `suite.clean()` so table cleanup
  is one implementation, not one per suite.
- **Assertions**: envelope and dialect assertions come from `test/support/assertions.ts` —
  `expectData`, `expectDataArray`, `expectNoContent`, `expectProblem` (RFC7807 plus the
  `X-Request-Id`/`traceId` echo), `expectRateLimited` (429 plus a truthful `Retry-After`),
  `expectObjectDeleted`, `uniqueEmail`, `sessionIdFromToken`. Inline re-derivations of those shapes are
  the duplication the duplication report keeps flagging; new specs use the helpers.
- **Env isolation**: `test/support/env-isolation.spec.ts` pins that the ambient pool configures no
  optional service (`RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `PUSH_PROVIDER`, `AUTH_SIGNING_KEYS_JSON(_BASE64)`). Specs
  inject what they need through `authEnv()`/overrides, so every "not configured" path stays
  deterministic. If that spec fails, remove the key from `.dev.vars` or `wrangler.jsonc` — do not relax
  the assertion.
- **No snapshots**: envelopes and problems are asserted structurally; snapshot files are not used.
- **Coverage**: reporters are `text-summary`, `lcov` and `json-summary`, floors are pinned in
  `vitest.config.ts`, and the CI workflow uploads `coverage/` as an artifact with 7-day retention
  (action pinned by commit). Coverage is a sensor, not a proof (ADR-0011).
- **Not ported, recorded**: dependency-tier gating (`SKIP_DEPS_TESTS`-style) has no analogue because
  Miniflare bindings are always present; DI/execution-context stubs have no counterpart because seams
  are injected through dependency objects and handlers are driven through HTTP or the job handler;
  tracked-ID cleanup stacks are unnecessary while isolation is per-file — revisit only if a real
  cross-suite collision appears.

## Mutation pilot (are the assertions real?)

`npm run test:mutation` (`scripts/mutation/pilot.mjs`) applies a seeded catalogue of behaviour-changing edits to
two pure policy files — `tools/cfkit/risk-classifier.ts` and `tools/cfkit/duration-policy.ts` — runs the spec
that is supposed to notice, and reports any mutation that **survives**. A survivor is the finding: it names an
assertion that does not exist yet.

- The pilot is **never** wired into a verify profile: it edits sources while it runs, so it is a deliberate,
  local, on-demand check (`npm run test:mutation`, or `--list` to print the catalogue).
- Restores are byte-verified (sha256) and happen in a `finally`, so a survivor or a crash cannot leave a
  mutated file behind.
- The report lands in the gitignored `.cfkit/mutation/report.json`.
- Threshold policy: the family's Stryker pilot allows a survivor budget (80/60/70). Ours does not — the
  catalogue is hand-picked and small, so **every** seeded mutation must be killed; the count is recorded in the
  report, and the honest way to add headroom is to keep the catalogue at zero survivors.

## Oracles (high-risk behaviour evidence)

`npm run oracles:check` (a `full`-profile step, registry in `tools/cfkit/oracles.ts`) names the high-risk
behaviours and where their end-to-end proof lives. Two states, both honest:

- **covered** — at least one evidence path under `test/integration/**` or `test/contract/**`; single-feature
  specs are structurally ineligible, because the claim is that the whole surface runs together.
- **pending** — the strongest evidence we have today plus the reason it is not end-to-end. Pending entries are
  printed by every check, so the gap is visible rather than assumed closed.

Every evidence path must exist, ids are dotted lowercase and unique, and an acceptance statement must describe
the behaviour. Changing an oracle to `covered` without adding end-to-end evidence fails the check.

## Rules

- **Determinism**: time comes from an injected `Clock` (fixed instants in specs); `Date.now()`
  does not appear in specs for anything asserted. Randomness that matters is injected
  (`retryDelaySeconds` takes its random source).
- **Real state over mocks**: the Workers pool provides D1, KV, Durable Objects, and queue
  consumers (`queueConsumers` in `vitest.config.ts`), so behavior is asserted against real
  bindings. Network calls are forbidden — external contracts are pinned as vectors instead
  (e.g. the AWS SigV4 example in the presign spec).
- **Fixtures**: shared helpers live in `test/` (`auth-fixtures`, `queue-fixtures`,
  `app-request`); specs stay self-contained otherwise.
- **Assertions that can fail**: a test must be probe-able — the task plan records at least one
  mutation run where the assertion goes red (ADR-0011). Counted assertions (log lines, purge
  counts, row counts) beat presence assertions for gates.
- **Gate honesty**: every check in `budget:check` and the drift/contract scripts ships with
  fixtures proving both the pass and the fail direction, and with a recorded probe.
- **Explicit registration traps**: `test:scripts` is an explicit file list — a new fixture file
  that is not added there silently never runs; Vitest's include covers only `src/**` and
  `test/**`. New test files must be registered deliberately.
- **Fixture hygiene**: fixture secrets are runtime-built (concatenation) or allowlisted with a
  reason (secrets scan); fixture state never depends on the live repository state (derive
  pre-state copies instead of reading what the run under test mutates).

## Definition of done for a change

- A behavior change ships with at least one new spec asserting the behavior and one probe
  proving the assertion can fail.
- Counting gates (fixtures, tests) referenced in plans are the numbers actually produced by the
  command that is quoted.
