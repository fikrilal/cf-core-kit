# ADR: Strict Quality Baseline and Gate Honesty

- Status: Accepted
- Date: 2026-10-10
- Decision makers: Core kit maintainers

## Context

The kit's goal is a codebase that stays readable and maintainable as it grows. The sibling kits show the family pattern: quality rules are executable, drift is checked mechanically, and gates are trusted because they are known to fail on violations (backendkit, frontendkit, mobilekit, gokit).

TypeScript tooling is permissive out of the box; "best practice" must be a curated, enforced baseline rather than a review convention. The harness makes the correct path the default path — scaffolded code starts green against the strictest rules.

## Decision

1. **Strict lint/format baseline** (landed 2026-10-10): type-aware eslint flat config — `strictTypeChecked` + `stylisticTypeChecked`; import hygiene via `import-x` (`first`, `newline-after-import`, `no-cycle`, `no-duplicates`, `no-mutable-exports`); budgets `complexity` 12, `max-lines` 350, `max-lines-per-function` 80; `no-console`; `eqeqeq`; Prettier. Violation probes confirmed each gate fails with its expected marker.
2. **Harness layers land with the phases that need them**: strict baseline, budget checks, and drift/docs checks in Phase 1; contract gates in Phase 2; feature-level boundary rules with the first feature; duplication policy and runtime evidence later. See `docs/exec-plans/roadmap.md`.
3. **Gate honesty**: every gate ships with a violation probe or a meta-test that injects a failure and asserts the gate fails with its expected marker. A check that cannot fail is not a gate.
4. **Baselines are reviewed artifacts**: where findings are baselined, only new findings fail; baseline updates require explicit approval, never a silent rewrite.
5. **Profiles, not step duplication**: `fast` / `full` / `runtime` / `ci` are defined once in the cfkit registry; `npm run verify` and CI call the same profiles; steps are fail-fast with stable ids and advisory duration budgets.

## Rationale

Rules that matter must fail builds, not reviews. The sibling kits prove this works at template scale: readers can trust the code shape, agents get immediate feedback, and drift cannot accumulate silently. Strictness is cheapest at the start and hard to retrofit — the scaffold is deliberately small, so the baseline is easy to hold.

## Consequences

Positive: readability and maintainability are enforced, not aspirational; budget and boundary regressions surface mechanically; one command verifies everything.

Negative: contribution friction is higher than editor defaults; the rule set needs occasional tuning as platform code lands; lint tooling versions must stay pinned with the rest of the toolchain.

## Alternatives Considered

- Default eslint recommended set only — rejected: misses complexity, size, import hygiene, and budget guardrails the family standard covers.
- Review-only conventions — rejected: does not scale and silently erodes.
- Copying a sibling config wholesale — rejected: ecosystems differ; only the practices transfer.

## Links / References

- Related ADRs: ADR-0005, ADR-0008, ADR-0009
- Related docs: `docs/core/project-stack.md`, `docs/exec-plans/roadmap.md`
