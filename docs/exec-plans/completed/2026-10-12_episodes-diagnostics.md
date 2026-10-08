# Episodes and diagnostics (harness parity C11)

- Status: completed
- Owner: fikrilal
- Risk: medium
- Date: 2026-10-12
- Related ADRs / proposals: `_WIP/2026-10-12_harness-parity-proposal.md` §5.4 (row 5.4), §7 batch C; ADR-0011 (sensors are not proof)

## Objective

Give the harness memory without storing prompts, secrets or raw output: `cfkit task verify` now writes a
schema-validated **episode** and a sanitized **diagnostic** for every attempt.

## Behaviour reference (backend-core-kit)

`evidence/episode.ts`, `diagnostics.ts`, `private-artifact.ts`: `attempt-<n>.json` validated against a schema
that forbids `prompt|reasoning|stdout|stderr|environment|credential|token|cookie|requestBody|databaseUrl`
anywhere in the document; `attempt-<n>.txt` capped at 16 KiB, tail-kept with `[TRUNCATED]` and regex-sanitized;
both written atomically as 0600 files in 0700 directories.

## Design

- `tools/cfkit/episodes.ts`: `buildEpisode` (task, attempt, lane, outcome, per-step id/status/exit code/duration,
  and for a failed step a `failure` block with the taxonomy code, repairability and the first failing line),
  `validateEpisode` (forbidden keys anywhere, schema version, shapes), `sanitizeDiagnostics` (the redaction
  table: authorization headers, bearer tokens, `X-Amz-Signature`/`X-Amz-Credential`, provider keys, JWTs, secret
  assignments, JWK private material, addresses), `capDiagnostics` (16 KiB, tail-kept, `[TRUNCATED]` marker),
  `writePrivateArtifact` (atomic temp+rename under 0700 with 0600) and `recordAttempt`.
- `runner.ts`: the step seam now carries output — `StepRunner` accepts an exit code or `{ exitCode, output }`, and
  `StepResult.output` holds the captured stream tail. Exit-code-only runners (every existing fixture) keep
  working unchanged; `defaultStepRunner` joins stdout and stderr from the capture A1 already made.
- `commands-task.ts`: `task verify` records the attempt (before the failure/success branch, so a _passing_
  attempt is an episode too) and prints both artifact paths.
- A failure block names the **first failing line** — the first line that looks like a failure (`error`,
  `failed`, `not ok`, `x `, `✗`), falling back to the first non-empty line — sanitized and capped at 200 chars.

## Constraints

- An episode may not carry streams, prompts, reasoning, environment or credentials; if validation fails the
  writer throws rather than persisting something weaker. Fixtures pin the forbidden-key rule for all ten keys.
- The diagnostic is sanitized _then_ capped, so the 16 KiB ceiling holds for the final bytes.
- Writes are atomic (temp file + rename) and private (0600 files in 0700 directories): the harness keeps memory
  of what failed, never of what you typed.
- Not in scope here: the runtime-evidence redaction table document (row 5.3, owned by plan F19) and the task
  state model (D14) — the state file keeps its existing mode, recorded as a follow-up.

## Acceptance Criteria

1. A built episode validates and carries the taxonomy code, repairability and first failing line (fixtures).
2. Forbidden keys anywhere in the document fail validation, for all ten names (fixtures).
3. Diagnostics redact credentials, provider keys, JWTs, signatures, secret assignments and addresses, and the
   cap keeps the tail with the marker at ≤ 16 KiB (fixtures).
4. `recordAttempt` writes private atomic attempt-N artifacts, leaves earlier attempts intact, and the file/dir
   modes are 0600/0700 (fixtures).
5. The wired path is proven live: a forced failure through `cfkit task verify` produced an episode with a
   `verify.plans` failure block and a sanitized diagnostic, and cleanup restored the tree.
6. `npm run verify`, `npm run verify:gates` and `npm run verify:ci` are green, and `evidence.episodes` flips to
   `present` (29 of 46).

## Steps

- [x] `tools/cfkit/episodes.ts` (build/validate/sanitize/cap/write/record)
- [x] runner output seam + `task verify` recording
- [x] 8 fixtures + `test:scripts` registration
- [x] exec-plans README contract note, live probe, manifest flip, bookkeeping

## Decision Log

- 2026-10-12: the step runner gained an `output` channel instead of a second recording path. -> the capture that
  diagnostics needs already existed in `process-runner` (A1); re-running a failing step to capture its output
  would double the cost of every failure and misreport the attempt.
- 2026-10-12: episodes are recorded for passing attempts too. -> an episode is memory of an attempt, not a
  failure log; C12's ledger is the consumer that needs a revision's whole history.
- 2026-10-12: the writer throws on a validation failure instead of redacting more aggressively. -> a forbidden
  key means the _producer_ leaked something into the structured document; silently scrubbing it would leave the
  leak in place for the next consumer.
- 2026-10-12: `firstFailingLine` looks for a failure-looking line rather than taking line one. -> the first line
  of npm output is usually a banner; a fixture now pins both the preference and the fallback.
- 2026-10-12: the fixture's key-shaped strings are assembled at runtime. -> the first version embedded a
  literal JWK and a literal secret assignment, and `secrets:check` failed on `tools/cfkit/episodes.test.ts`
  the moment the file became **tracked** (the scan reads the index, so the pre-commit run was green and the
  isolated-tree verify caught it right after the commit — the same trap A6 hit). The fixture now builds the
  values from constants, which keeps the sanitizer's patterns under test while the file itself matches
  nothing, exactly as the testing standard's fixture-hygiene rule prescribes.
- 2026-10-12: the live probe used two active plans as the forced failure. -> it fails `plans:check` at the first
  step in ~200 ms, so the wired write path is proven at almost no cost and the tree is restored by deleting two
  scratch files.

## Verification

```bash
node --test tools/cfkit/episodes.test.ts   # 8 fixtures: schema, forbidden keys (all ten), redaction,
                                           # tail-kept cap, first failing line, private atomic writes, verified attempt
# live probe (recorded): active plan + second active plan -> `task verify --task probe-episodes`
#   -> attempt 1/3, failing plans:check, exit 1, and:
#   .cfkit/tasks/probe-episodes/episodes/attempt-1.json     0600  436 B  (failure: verify.plans, firstLine = the count rule)
#   .cfkit/tasks/probe-episodes/diagnostics/attempt-1.txt   0600  268 B  (sanitized output, no forbidden keys)
#   cleanup -> docs/exec-plans/active/ empty, plans:check green
npm run verify                             # fast profile green
npm run verify:gates                       # 8/8 gates bite
npm run verify:ci                          # ci profile green
```

## Post-review fixes (2026-10-13)

- `tools/cfkit/episodes.test.ts` no longer contains a literal JWK or a literal secret assignment: the values
  are assembled at runtime, and `secrets:check` is clean on the tracked corpus. The plan's own verification
  section records that the isolated-tree run caught it after the first commit, and the follow-up commit carries
  the fix.

## Completion Notes

The harness now remembers attempts structurally: schema-validated episodes and sanitized, tail-kept diagnostics,
both private and atomic. The runner grew an output channel rather than a second capture path (the process
runner already had the bytes), and the recording happens before the pass/fail branch so verified attempts are
memory too. The live probe exercised the wired path end to end with a forced `plans:check` failure in ~200 ms and
left nothing behind. Two follow-ups are recorded: the pre-existing task state file keeps mode 0664 (D14 owns the
state model), and the runtime-evidence redaction table is documented in F19 while the mechanism already lives
here.
