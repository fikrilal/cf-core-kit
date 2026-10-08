# Execution Plans

Execution plans turn accepted proposals and ADRs into sequenced, verifiable work.

- Active plans live in `docs/exec-plans/active/`; completed plans move to `docs/exec-plans/completed/`.
- The roadmap (`roadmap.md`) is the high-level phase and task index; it never replaces an execution plan.
- Create plans from `_template.md`.
- A plan is not a proposal: decisions and boundaries come from `docs/adr/` and `_WIP/` proposals; plans define steps, gates, and evidence.
- Record exact verification commands and outcomes in the plan as work lands. Budget-impacting changes (rows written, subrequests, KV writes) record their measured profile.

## Header conventions (machine-read)

`npm run plans:check` (the first step of the `fast` and `full` profiles) validates the corpus, so the
conventions below are enforced, not advisory:

- `- Status: queued | active | completed` — must match the folder; `cfkit task begin --plan <path>` requires
  `active` and refuses plans outside `docs/exec-plans/active/`; completed plans move to `completed/`.
- Task ids come from `- Task ID:` (or the file name) and must be unique kebab-case, 3-80 characters.
- Every plan carries `## Objective` and `## Verification`; plans that are still moving (active/queued) also
  carry `## Steps`, `## Acceptance Criteria` and the full metadata block from `_template.md`: `Risk` and
  `Maximum risk` (risk may not exceed the maximum), `Authority` (must include `edit` and `verify`),
  `Repair limit`, `Task timeout` (≤ 24 h), `Impact areas`, `Allowed paths`, `Allowed actions`.
- `completed/` plans must have every step checked; `active/` holds at most one plan.
- **Grandfathering, recorded:** completed plans that predate this contract carry no metadata block (their
  `Authority`, `Repair limit` and `Allowed paths` were never agreed, and inventing them afterwards would be
  worse than requiring them for new work). The contract binds active and queued plans, and every plan is held
  to the folder, id, section and checkbox rules.
- `- Risk: low | medium | high` — the declared risk; `task begin` classifies the working diff and
  the effective risk is the higher of the two (risk may raise, never lower).
- Tasks track their lane (`fast`/`full`/`ci`), attempts, and failures under gitignored `.cfkit/`;
  `cfkit task verify` runs the lane profile with bounded repair.
- Every attempt also records **structured memory** under `.cfkit/tasks/<id>/`: an episode
  (`episodes/attempt-<n>.json`, schema-validated, and it may not contain prompts, reasoning, streams,
  environment or credentials — a forbidden key anywhere fails validation) and a sanitized diagnostic
  (`diagnostics/attempt-<n>.txt`, ≤ 16 KiB, tail-kept with `[TRUNCATED]`, with bearer tokens, provider keys,
  JWTs, signed-URL signatures, secret assignments and addresses redacted). Both are written atomically as
  0600 files inside 0700 directories: the harness keeps memory of _what failed_, never of what you typed.
- The `Impact Areas` list should be answered honestly — it is what a reviewer checks the diff
  against — and `Verification` records exact commands with their real outcomes.
