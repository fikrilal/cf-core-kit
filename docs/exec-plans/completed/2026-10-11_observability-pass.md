# Observability pass: log economy + trace continuity (task 4.4)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-11
- Related ADRs / proposals: ADR-0005 (budget), ADR-0011 (gate honesty); roadmap task 4.4

## Objective

The observability pass closes Phase 4: the log economy becomes an enforced rule (console
output is confined to the platform logger, so leveling and redaction cannot be bypassed), the
`traceId` chain gets explicit assertions (inbound header → response echo → problem `traceId` →
request log → job logs), and the `observability` standard lands as the normative reference.

## Verified current behavior (the invariants the specs assert)

- `requestLogging` emits exactly one line per request: `info "request"` for <400,
  `warn "request"` for 4xx, `error "request"` for 5xx, and it skips `/health` and `/ready`
  entirely. Failures additionally emit exactly one `request error` line from the central error
  handler (`warn` for client errors with `code`, `error` for 5xx with `stack`).
- Every line carries `requestId`; the response echoes `X-Request-Id` and problems carry it as
  `traceId`; an inbound client-provided id is honored end to end.
- Jobs log with the envelope's `traceId` (cron ticks use `cron:<scheduledFor>`), and the DLQ
  consumer logs each dead letter with its envelope identity — both already asserted in
  `worker.spec.ts` and the cron integration spec.

## Constraints

- The budget rule is a confinement scan, not a style opinion: `console.*` outside
  `src/platform/logging/` fails `budget:check` (the logger is the only place console exists
  today), so ad-hoc output cannot bypass levels or redaction.
- The economy specs assert _counts_ (one line per request, zero for probes), not just presence.
- The standard documents rules, not aspirations; every rule it states is either budget-enforced
  or spec-asserted, and the plan records which.

## Impact Areas

- Budget: console-confinement rule + fixtures; Tests: a new HTTP observability spec;
  Docs: `observability` standard + standards index + roadmap Phase 4 completion.

## Acceptance Criteria

1. `budget:check` rejects `console.*` in any production source outside `src/platform/logging/`
   (fixtures prove both directions).
2. HTTP economy: a successful request logs exactly one line with `requestId` equal to the
   echoed `X-Request-Id`; a client failure logs exactly one `request error` warn carrying the
   problem's `code`; a server failure logs exactly one `error` line; `/health` and `/ready`
   log nothing.
3. Trace continuity: a client-supplied `X-Request-Id` appears identically in the response
   header, the problem `traceId`, and the log line; the generated id does the same when none is
   supplied.
4. The `observability` standard lands and the standards index marks it active; `verify:ci`
   green.

## Steps

- [x] Budget rule + fixtures
- [x] HTTP observability spec (economy + continuity)
- [x] Standard + index + roadmap; verify + bookkeeping

## Decision Log

- 2026-10-11: the log-economy check is a console-confinement rule plus counted assertions, not a line-count budget constant. -> line counts differ legitimately per path; what must be invariant is that logging goes through the level-aware, redacting logger and stays one-line-per-unit of work
- 2026-10-11: no new runtime logging behavior. -> 4.4 audits and pins what exists (ADR-0011 gate honesty); inventing metrics/exports without a consumer would be speculative

## Verification

```bash
npm run verify:ci   # full profile green: 316 vitest tests across 51 files, 68 script fixtures,
                    # budget 1218.57 KiB, drift, parity, spectral, build
# observability tests: one info line per successful request with the echoed requestId; zero
#   lines for /health probes; one warn line for a returned 404; a client-supplied X-Request-Id
#   identical across response header, problem traceId, and the warn line (with the code); a
#   generated id doing the same for a 500 crash with exactly one error line and no request line
# budget: console confinement fixtures (platform logger allowed, feature rejected)

## Completion Notes

The pass pinned real behavior rather than adding new surface: the budget rule confines
`console.*` to the platform logger (the only place it existed), the spec asserts counted
invariants (one line per request, zero for probes, exactly one failure line) and the full
header/body/log identity chain for both client-supplied and generated ids, and the standard
records the rules that are budget-enforced or spec-asserted. One discovery worth keeping: the
success and 404 lines come from the `requestLogging` middleware while thrown errors are logged
by the central error handler, so a test app that mounts routes without that middleware logs
only failures — the spec now mounts it and the invariant is documented in the standard. Phase 4
is complete with this task; the two credentialed follow-ups (dashboard CPU, live R2 upload)
remain tracked in their plans.
```
