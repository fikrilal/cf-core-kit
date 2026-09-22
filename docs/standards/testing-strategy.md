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
