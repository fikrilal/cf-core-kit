# Duplication policy: blocking core profile with reviewed allowlists (roadmap follow-up)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0011 (strict quality baseline and gate honesty); roadmap Phase 6 follow-up

## Objective

Duplication becomes a blocking gate in the `full`/`ci` profiles: `jscpd` (locked to `min-tokens
60`) reports clones across `src/`, `scripts/`, and `tools/`, and any clone whose two files are
not covered by one reviewed allowlist entry fails the check.

## Findings and cleanups (measured, not asserted)

- The first measurement over `src/**` found two real clones inside
  `src/platform/http/openapi.ts` (the duplicated document/operation resolution in
  `applyOperationParameters` and `applyErrorCodeExtensions`). They were **refactored away** —
  `requirePaths`/`requireOperationObject` now serve both — rather than allowlisted, leaving
  `src/` at zero clones.
- The wider measurement surfaced a test duplicating `commands-remove.ts`'s `repoAccess` helper;
  that helper is now exported and shared, so the duplication is gone rather than forgiven.
- Excluding generated and mirror artifacts (`worker-configuration.d.ts`, `db/migrations/**`,
  `contracts/**`, `docs/openapi/openapi.yaml` via the pattern scope) is part of the config: they
  are reproduced by tooling, not maintained by hand.
- What remains after the cleanups: exactly one clone — the `isDirectRun` entrypoint boilerplate
  shared by `scripts/budget/check.mjs` and `scripts/drift/check.mjs` — allowlisted with its
  reason (each check script stays individually runnable).
- Spec and test files are outside the scan: shared test scaffolding is expected; the policy
  targets maintained source.

## Verification

```bash
node --test scripts/duplication/check.test.mjs   # 4 tests: group-covered pair allowed,
                                                 # half-covered pair violates, empty allowlist
                                                 # violates, committed entries carry reasons
node scripts/duplication/check.mjs               # "clones: 1 (0.13% of lines); allowlisted: 1;
                                                 # no unallowlisted clones"
# probe: emptying the allowlist turns the gate red with the unallowlisted clone printed;
#   restored -> green
npm run verify:ci                                # duplication:check runs in full/ci (fast loop
                                                 # stays fast)
```

## Decision Log

- 2026-10-11: refactor real duplication, allowlist only conventions. -> the two source clones were a genuine smell (now fixed); the surviving entry is boilerplate that would be worse if shared
- 2026-10-11: min-tokens 60. -> below that, similarity is idiom, not duplication; the setting is pinned in the checker and in the recorded measurement
- 2026-10-11: a clone is allowed only when BOTH files appear in the same reviewed entry. -> one-sided entries would silently bless unrelated copies
