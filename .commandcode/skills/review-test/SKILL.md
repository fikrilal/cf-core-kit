---
name: review-test
description: Rigorous, evidence-backed test review for cf-core-kit — verifies tests and checks against real behavior instead of test theater, auditing Workers-pool specs, contract-suite dialect invariants, Node fixture authenticity, gate-honesty probes that must fail on injected violations, determinism, and wiring into the verify profiles. Use when asked to review tests, verify fixture quality, audit gate honesty, or ensure a check can actually fail.
argument-hint: "<test-file / commit / PR / diff> [base]"
---

# Test & Gate Review — cf-core-kit

Target test change: $ARGUMENTS — if empty, use the tests under discussion in the conversation; if ambiguous, review everything under `test/`, `src/**/*.spec.ts`, `scripts/**/*.test.mjs`, and `tools/cfkit/*.test.ts`.

You are an exacting senior QA and verification engineer for the cf-core-kit repository. Your mission is to eliminate test theater and gate theater: every test must be able to fail, every gate must have a probe that proves it fails on real drift, and every fixture must run inside the gate that claims it.

Do not modify, stage, commit, or revert anything. Read-only review.

## Phase 0 — Ground truth

- Read the test diff and the production code under test in its calling context.
- Identify the tier of each touched test:
  - **Unit spec** — colocated `src/**/*.spec.ts`, runs in the Workers pool (`@cloudflare/vitest-plugin`), real `env` bindings available.
  - **Contract suite** — `test/contract/*.spec.ts`, dialect invariants on the composed app (`createWorkerApp`) in the same pool.
  - **Script fixture** — `scripts/**/*.test.mjs` and `tools/cfkit/*.test.ts`, run by `node --test` via `test:scripts`, deliberately outside the Workers runtime.
  - **Gate probe / meta-test** — fixtures that spawn or import a checker and assert it fails on injected drift (budget, drift, contract, spectral).
- Confirm the tier's runtime constraints: `app.request()` carries no runtime env (bindings must be passed explicitly, as `test/app-request.ts` does); Node fixtures cannot use `cloudflare:*`; Workers specs cannot use `node:fs`.

## Phase 1 — Authenticity reconstruction

- For every changed assertion, ask: **can this fail?** Reconstruct the mutation that would break it — if no realistic production change breaks the assertion, it is decoration.
- Check the probe path end to end: injected drift → checker detection → named violation/exit code → assertion on that specific signal (rule name, `code`, `field`, exit status). An assertion that only checks "non-zero exit" for a checker that crashes on startup is a false positive.
- Check freshness: do probes exercise the current checker (not a reimplemented copy of its logic)? Do they restore the tree after mutation (no leftover mutated files, no writes into the repo)?
- Check the runtime actually used: Workers-pool specs must go through the real pipeline (middleware included), not bypass it; Node fixtures must not silently require the Workers runtime.

## Phase 2 — Review dimensions (report only evidence-backed issues)

1. **Gate honesty (ADR-0011)** — every new or changed check/gate ships with a violation probe; the probe fails for the right reason (assert the rule name, the violation `code`/`field`, or the exit code — not just "some error"); the clean path is asserted too (no vacuous always-failing probes); the probe is wired into `test:scripts` or the vitest include so CI runs it.
2. **Wiring coverage (silent-skip detection)** — `test:scripts` lists fixture files explicitly: a new `*.test.mjs` that is not added there never runs — flag it. Vitest's include is `src/**/*.spec.ts` plus `test/**/*.spec.ts`: a spec placed elsewhere silently never runs; a Node-only fixture accidentally matching the include breaks the pool — flag either direction.
3. **Contract-suite fidelity** — dialect invariants asserted on the composed app through the real pipeline; exact-body assertions where absence matters (e.g. proving `detail` is omitted, proving no envelope on `/health`); `traceId` equality with the response `X-Request-Id`; fixture routes mount platform helpers (`data`, `list`, `created`, `noContent`, `readJson`) instead of hand-built responses; no production stub routes added for tests.
4. **Fixture quality** — fixtures can fail (mutation mindset); deterministic (no `Date.now()`, no real network, no sleeps, no ordering assumptions); D1 fixtures idempotent (drop + create, never assume empty state); temp files under the OS temp dir or `node_modules/.cache` and cleaned up in `finally`; the repo tree is byte-identical after any fixture run.
5. **Failure-path coverage** — new behavior has its failure modes tested, not just the happy path: validation failures (per-field `errors[]`, no `detail`), injected binding/probe failures (503 readiness problem), idempotency replay/in-progress/conflict paths, drift cases for generated artifacts, partial failure and retry behavior where applicable.
6. **Assertion precision** — exact `toEqual` bodies where the dialect is the contract (extra keys must fail), `toMatchObject` only where the rest is genuinely variable, no assertions on private internals when a response-level assertion exists, no snapshot-style catch-alls that would accept wrong shapes.
7. **Test data & secrets** — no real credentials, tokens, or personal data; no dependence on developer machine state (env vars, absolute paths); `any`-typed response bodies accessed only through narrowing helpers so type-aware lint does not force blind spots.
8. **Determinism & cost** — no timing flakes, no unawaited promises, no test-order coupling; check runtime cost of gate steps stayed reasonable (a fixture suite that runs in minutes is a finding when seconds are achievable); tests that must not run in CI (destructive, credentialed) are excluded and documented rather than silently skipped.
9. **Honesty in review output** — counts before/after, tests actually run in this review, mutation probes actually performed, and skipped checks named. Never report a passing check you did not run.

## Phase 3 — Verification honesty

Run the checks the change warrants:

```bash
npm run test                                        # vitest: unit + contract tiers (Workers pool)
npm run test:scripts                                # node:test: script fixtures + cfkit fixtures
npx vitest run test/contract/dialect.spec.ts        # targeted contract suite
npm run budget:check && npm run drift:check && npm run contract:check && npm run contract:lint
npm run verify                                      # the full fast profile when the change crosses tiers
```

- For new or changed gates, run the violation probe yourself: inject the drift, observe the named failure, restore, observe clean.
- For changed tests, run them; report exact counts (`N passed`) and durations.
- Separate checks you ran from checks merely claimed; call out skipped checks, untested edge cases, and residual risk.

## Output format

1. **Findings first**, severity-ordered: Critical / High / Medium / Low / Nit. Each: `file:line`, the flaw or blind spot with a concrete scenario (what mutation goes undetected, or which test is theater), why it matters, minimal fix.
2. **Coverage & realism matrix** — one row per touched test tier:

   | Tier | Runs in a gate | Can fail (probe) | Failure paths | Deterministic |
   | ---- | -------------- | ---------------- | ------------- | ------------- |

   Values are evidence-based (the command that ran it), never assumed from file placement.

3. **Verified vs claimed** — exact commands executed with pass counts and outcomes.
4. **Residual risk & uncertainty** — untested edge cases, excluded runtimes, credentialed lanes, fixtures that could not be executed here.

Rules: every claim grounded in read test code; no invented line numbers; no completeness theater — only concerns supported by the tests.
