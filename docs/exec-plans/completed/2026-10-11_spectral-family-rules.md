# Spectral family rules and gate-honesty meta-test (task 2.5)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0002 (mechanism 1: artifact shape; lint-gated per proposal §5.3), ADR-0011 (gate honesty); roadmap task 2.5

## Objective

The emitted snapshot is lint-gated with the family ruleset mirrored from backend-core-kit's `.spectral.yaml`: `extends: spectral:oas` plus `operation-operationId: error`, `operation-tags: error`, and the custom `x-error-codes-required` rule (given every operation object, `x-error-codes` must be truthy). `scripts/contract/lint.mjs` runs the lint behind `npm run contract:lint` and as a cfkit passthrough + fast profile step. The gate-honesty meta-test injects drift (drop `x-error-codes`; drop `operationId`; drop `tags`) into temp copies of the spec and asserts the lint fails naming the right rule — and passes on the committed spec.

## Constraints

- Dependency: `@stoplight/spectral-cli@^6.17.0` (devDependency; backend pins `^6.16.0`).
- Ruleset file: `.spectral.yaml` at repo root, mirroring backend's three rules; divergence from the family ruleset requires an ADR.
- Invocation mirrors backend: `spectral lint --fail-severity warn docs/openapi/openapi.yaml`.
- Meta-tests spawn the CLI on temp YAML copies (Node `node:test`, same pattern as budget/drift fixtures); each drift case asserts non-zero exit and the rule name in output. The committed-spec pass case runs in the same file so the tests prove both directions.
- Wiring: `contract:lint` npm script; cfkit passthrough + fast profile step (list order: budget:check, drift:check, contract:check, contract:lint); cfkit fixture + USAGE updated.
- Spectral runs on our emitted spec only; the pinned backend snapshot is upstream's artifact and is not linted here (its lint lives in backend CI).

## Impact Areas

- API / contract: yes (lint gate on the committed artifact)
- CI / release: yes (fast + full profiles gain `contract:lint`; CI inherits)
- Docs: no (rules mirrored from the family; noted in contracts/README)

## Acceptance Criteria

1. `npm run contract:lint` passes on the committed spec and fails on each injected drift case (fixture-proven via spawned CLI, rule name asserted).
2. Fast profile includes `contract:lint`; cfkit delegating command works; `npm run verify` green (lint step timing recorded).
3. Roadmap 2.5 checked; plan filed to `completed/`.

## Steps

- [x] Add the devDependency + `.spectral.yaml` + `scripts/contract/lint.mjs` + npm script
- [x] Meta-test fixtures (pass case + three drift cases)
- [x] cfkit passthrough + profile step + fixtures; verify + bookkeeping

## Decision Log

- 2026-10-11: meta-test spawns the real CLI on temp copies instead of invoking Spectral as a library. -> tests the exact command CI runs; no second integration surface
- 2026-10-11: `--fail-severity warn` mirrors backend. -> family gate semantics stay identical; new oas warnings fail here too

## Verification

Exact commands and outcomes:

```bash
node scripts/contract/lint.mjs   # "No results with a severity of 'warn' or higher found!" (exit 0)
npm run test:scripts             # 49 fixtures (4 spectral meta-tests: pass + 3 drift cases)
# drift probe: x-error-codes stripped from the committed spec -> exit 1,
#   "17:9 error x-error-codes-required Missing x-error-codes on operation." -> re-emit restored (exit 0)
# en route: the first lint run caught real gaps (info.description/contact missing,
#   tags referenced but not declared globally) -> the emitter now mirrors the family
#   info fields and the global Health tag; backend .spectral.yaml rules mirrored verbatim
npm run verify:ci                # full profile: contract:lint step green (1.2s)
```

## Completion Notes

`.spectral.yaml` mirrors the backend ruleset (`spectral:oas` + `operation-operationId`, `operation-tags`, and the custom `x-error-codes-required` rule); `scripts/contract/lint.mjs` spawns the CLI exactly as the family does (`--fail-severity warn`). The meta-tests spawn the real CLI on temp YAML copies: committed spec passes, and dropping `x-error-codes`, `operationId`, or `tags` each fails naming the right rule. Wired as `contract:lint` (npm script, cfkit passthrough, fast profile step after `contract:check`; cfkit fixture updated). The first lint run did its job: it caught missing `info.description`/`contact` and undeclared global tags, fixed by mirroring the backend's info fields and Health tag in the emitter.

## Follow-ups

- [ ] Phase 3+ operations inherit the lint automatically via the registry emission
