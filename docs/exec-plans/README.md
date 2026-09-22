# Execution Plans

Execution plans turn accepted proposals and ADRs into sequenced, verifiable work.

- Active plans live in `docs/exec-plans/active/`; completed plans move to `docs/exec-plans/completed/`.
- The roadmap (`roadmap.md`) is the high-level phase and task index; it never replaces an execution plan.
- Create plans from `_template.md`.
- A plan is not a proposal: decisions and boundaries come from `docs/adr/` and `_WIP/` proposals; plans define steps, gates, and evidence.
- Record exact verification commands and outcomes in the plan as work lands. Budget-impacting changes (rows written, subrequests, KV writes) record their measured profile.

## Header conventions (machine-read)

- `- Status: queued | active | completed` — `cfkit task begin --plan <path>` requires `active` and
  refuses plans outside `docs/exec-plans/active/`; completed plans move to `completed/`.
- `- Risk: low | medium | high` — the declared risk; `task begin` classifies the working diff and
  the effective risk is the higher of the two (risk may raise, never lower).
- Tasks track their lane (`fast`/`full`/`ci`), attempts, and failures under gitignored `.cfkit/`;
  `cfkit task verify` runs the lane profile with bounded repair.
- The `Impact Areas` list should be answered honestly — it is what a reviewer checks the diff
  against — and `Verification` records exact commands with their real outcomes.
