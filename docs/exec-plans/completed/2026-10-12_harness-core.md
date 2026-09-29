# Harness-core: capture, taxonomy, exit codes, profile invariants (harness parity A1)

- Status: completed
- Owner: fikrilal
- Risk: low
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.1 (rows 1.2, 1.3, 1.4, 1.7, 1.8), §7 batch A; ADR-0009 (cfkit and the verify gate), ADR-0011 (gate honesty)

## Objective

The first plan of the harness-parity programme. It lands the verification core the rest of the batches lean
on: a structured process runner that captures each step's output (so later plans can write redacted
diagnostics), the failure taxonomy that turns a failing step id into an actionable code + remediation +
repairability verdict, the family's exit-code contract (`0` ok, `1` error, `2` usage), the profile-registry
invariants as fixtures, and the parity manifest skeleton that every later plan updates.

## Behaviour reference (backend-core-kit)

- `verification/run-profile.ts`: fail-fast, per-step duration, advisory budget line.
- `verification/failure-taxonomy.ts`: step id -> `{code, remediation, repairable}`; an unknown step is
  `harness.unknown-step` and **unrepairable** ("escalate"), so a green-but-unmapped step cannot happen.
- `process-runner.ts`: structured subprocess results (exit code, signal, streams) rather than raw stdio.
- `command.ts`/`cli.ts`: exit `0` success, `1` error, `2` usage (strict option parsing; unknown flags and
  missing option values are usage errors).
- The oracles and ledger plans consume these descriptors; the parity manifest is the programme's checklist.

## Design

- `tools/cfkit/process-runner.ts`: `runProcess({command, args, cwd, timeoutMs, maxCaptureBytes, passthrough})`
  -> `{exitCode, signal, timedOut, durationMs, stdout, stderr, stdoutTruncated, stderrTruncated}`. Streams stay
  live (tee to the parent's stdio) while a rolling tail buffer keeps the last 64 KiB per stream, so failures
  are capturable without unbounded memory; a timeout kills the child and reports exit `124`.
- `tools/cfkit/failure-taxonomy.ts`: one descriptor per profile step id (17 entries once `harness:parity` is
  wired), plus the unrepairable unknown-step fallback; codes follow the family's stable-id pattern
  (`verify.*`, `runtime.verification`, `harness.unknown-step`).
- `tools/cfkit/runner.ts`: becomes async, runs each step through the injected `StepRunner` (sync or async, so
  existing stubs keep working), attaches the descriptor to failed results, and prints
  `-> <code>: <remediation> (repairable|escalate)`.
- `tools/cfkit/cli-args.ts`: strict flag validation (`assertFlags`, `requireFlagValue`) throwing
  `UsageError`; `tools/cfkit/usage-error.ts` defines it; `tools/cfkit/cli-main.ts` exports `main()` and maps
  `UsageError` -> exit `2` (help -> `0`, no command -> `2`, domain refusals stay `1`); `cli.ts` becomes a thin
  entry with top-level await.
- `tools/parity/harness.json` + `scripts/parity/harness.mjs`: the parity manifest skeleton (row id, area,
  family reference, target, status `present|declared-only|missing`, plan number, optional path) with a schema
  validator that fails on malformed rows, duplicate ids, unknown statuses, and `present` rows whose declared
  path is missing. Wired into the fast profile as `harness:parity`. Plan F20 adds the tree-wide comparison and
  the acceptance closeout.

## Constraints

- Additive tooling only: no runtime, wire-contract, migration, or budget change; nothing new runs inside the
  Worker.
- No `as` assertions in `src/**`; tools may use them only where the tool's own contract is the subject.
- The exit-code change is a real behaviour change for scripts: usage errors now exit `2` instead of `1`;
  domain refusals (unknown task, scaffold/remove refusal, handoff refusal) stay `1`.
- Every new check ships a fixture that proves it can fail (ADR-0011).
- Node type-stripping constraints apply to the fixtures (no enums, namespaces, or parameter properties).

## Acceptance Criteria

1. `runProfile` is async, captures each step's output, keeps the live output, and reports a failing step with
   its descriptor; the existing runner semantics (order, fail-fast, durations, advisory line) are unchanged.
2. `failureDescriptor` covers every step id in every profile (fixture), returns the unrepairable
   `harness.unknown-step` fallback for an unmapped id (fixture), and every entry has a non-empty remediation
   and a valid code (fixture).
3. `cfkit` exits `2` for usage errors (no command, unknown command, unknown flag, missing flag value, unknown
   profile, unknown subcommand) and keeps `0`/`1` semantics elsewhere (fixture).
4. Profile invariants are pinned: `expandProfile("ci")` equals the union of `full`+`runtime`+`smoke` step ids
   in order, no profile repeats a step id, and every expanded step's script exists in `package.json` (fixture).
5. `runProcess` captures stdout/stderr/exit codes, tail-truncates beyond the cap, and reports timeouts with
   `timedOut: true` (fixture).
6. `harness:parity` validates the manifest (schema, unique ids, statuses, `present` paths) and fails on a
   malformed row (fixture); it runs as a fast-profile step.
7. `npm run verify` stays green; `typecheck:cfkit` and lint stay clean.

## Steps

- [x] process-runner + runner wiring (capture, descriptor, async)
- [x] failure taxonomy + CLI exit-code contract (`UsageError`, strict flags, `cli-main`)
- [x] fixtures (process-runner, taxonomy, profiles, cli usage) + `test:scripts` wiring
- [x] parity manifest skeleton + validator + fast-profile step + proposal F20 row amendment
- [x] verify (typecheck:cfkit, lint, fixtures, fast profile), probe the new checks, bookkeeping

## Decision Log

- 2026-10-12: `runProfile` becomes async. -> capturing output while keeping live progress rules out
  `spawnSync`; the family's runner is async for the same reason. Stubs may stay sync.
- 2026-10-12: capture keeps the **tail** (64 KiB per stream). -> failures end with the error; the family's
  diagnostics use the same tail-keeping policy (capped at 16 KiB at the diagnostic layer, plan C11).
- 2026-10-12: usage errors exit `2`, everything else keeps `1`. -> matches the family's contract and lets
  scripts distinguish "you called me wrong" from "the repository is wrong".
- 2026-10-12: the parity manifest is created here, not in plan F20. -> the roadmap's rule "every plan updates
  the manifest" needs a manifest to exist; plan F20 keeps the tree-comparison checker and the closeout.

## Verification

```bash
npm run typecheck:cfkit                # clean after the async runner + strict flag helpers
npx eslint .                           # clean (complexity splits in cli-args/commands, holder state in the runner)
npm run test:scripts                   # 134 fixtures pass (was 112): +22 for the new devices
npm run harness:parity                 # rows: present 13, declared-only 33, missing 0
# probe: deleting one taxonomy entry turns "every step id has a registered failure taxonomy entry" red;
#   revert restores green (ran)
# the validator's teeth were demonstrated live: it failed with
#   "core.profile-invariants: evidencePath does not exist: tools/cfkit/profiles.test.ts" before that fixture existed
npm run verify                         # fast profile green, now including the harness:parity step
```

## Completion Notes

Landed the verification core the rest of the programme depends on:

- `tools/cfkit/process-runner.ts` — structured capture with live passthrough, a rolling 64 KiB tail per stream
  (so failures survive truncation), and timeout kill reporting exit `124`.
- `tools/cfkit/failure-taxonomy.ts` — 17 step descriptors with stable codes plus the unrepairable
  `harness.unknown-step` fallback; `runner.ts` attaches the descriptor to failed steps and prints
  `-> code: remediation (repairable|escalate)`.
- `tools/cfkit/usage-error.ts` + strict `assertFlags`/`requireFlagValue` + `cli-main.ts` — the family's exit
  contract (`0` ok, `1` error, `2` usage) with `cli.ts` reduced to a thin entry; domain refusals (unknown task,
  scaffold/remove refusal, handoff refusal) stay `1`, and the handoff fixture was updated to assert the new
  usage contract.
- Fixtures: profile composition/uniqueness/taxonomy-coverage invariants, taxonomy shape rules, process-runner
  capture/truncation/timeout, and seven CLI usage paths.
- `tools/parity/harness.json` (46 rows: 13 `present`, 33 `declared-only`) + `scripts/parity/harness.mjs`
  (schema, unique ids, statuses, evidence rules — `present` rows must name an existing path or a real npm
  script, non-present rows must not claim evidence) wired into the fast profile as `harness:parity`.

Deliberate scope notes: the manifest's `handoff.bound-approvals` row is recorded as already `present` — the
15-minute lifetime, challenge hash, fingerprint and path binding existed before this programme — with a note
that workspace/branch binding lands in plans 15–16; the proposal's §5.6 row 6.5 overstated that gap and the
manifest is now the precise record.

## Post-review fixes (2026-10-12)

Six findings from the change review, all reproduced with live probes before fixing:

- **[High] a syntax error could burn a valid handoff grant.** `handoff commit` without `--message` threw
  `UsageError` _after_ approval verification, so `runMutation`'s catch marked the approval `uncertain` and
  exited `1`. Fixed twice over: `assertMutationFlags` now validates `--task`, `--challenge` and the
  subcommand's own flags (commit: `--message`) before any approval is read, and `runMutation`'s catch
  re-throws `UsageError` instead of degrading it. Probe: `handoff commit --task t --challenge c` in a clean
  directory exits `2`, prints `missing required flag "--message"`, and writes **no** `.cfkit` state.
- **[High] `remove feature --yes` treated the flag as the target.** `args[1]` was read as the name, so a
  flag-only invocation tried to remove a feature literally called `yes` and exited `1`. `positionalTarget`
  now picks the first non-flag positional (also making `remove feature --yes my-feature` work) and raises a
  usage error when it is missing. Probe: `remove feature --yes` exits `2` with
  `remove feature needs an argument`.
- **[Medium] `task verify` / `task status` without `--task` exited `1`.** Both now use
  `requireFlagValue` through a shared `lookupTask` helper (which also removed the clone the duplication gate
  then flagged). Probe: both exit `2` with `missing required flag "--task"`.
- **[Low] the process-runner timer could outlive a spawn error.** `clearTimeout` moved into a promise
  `.finally`, so every path (close, error, timeout) clears it; `PROCESS_TIMEOUT_MS` is now actually applied
  by `defaultStepRunner` instead of being an unused export.
- **[Low] fixture blind spot.** `cli-main.test.ts` gained the flag-only `remove`, `task verify/status`, and
  handoff-without-`--message` cases, so all three contract violations above now fail a fixture.
- **[Nit] advisory manifest evidence fields.** `harness.mjs` rejects non-string `evidencePath`
  (`evidencePath must be a string`) and `evidenceCommand`, with fixture cases for both.

Verification after the fixes: `typecheck:cfkit`, `eslint`, `test:scripts` (134 fixtures) and
`npm run verify:ci` all green — the ci profile including the scaffold smoke, which exercises
`remove feature <name> --yes` as regression coverage for the second finding.
