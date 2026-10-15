# Loop engineering

How to keep a long task honest when it spans more turns than attention spans: plan first, verify often, and let
the harness carry the memory.

**One plan, one outcome.** A plan states its objective, acceptance criteria and the exact verification commands
_before_ work starts; `plans:check` enforces the shape and `cfkit task begin` binds the work to it.

**Small verifications, early.** `npm run verify` after every meaningful edit. The fast profile exists to be
cheap enough to run constantly (`plans:check` first, then the static gates), and the failure taxonomy names the
repairable failures so a loop can fix them without guessing.

**The lane follows the risk.** `cfkit ci classify` (or `task begin`) decides `fast`/`full`/`ci` from the diff.
Do not run the `ci` profile "to be safe": run it because the diff touches runtime, schema or auth paths.

**Stop conditions are explicit.** A task's plan carries `Repair limit` and `Task timeout`; exceeding either
escalates with a stop reason instead of looping. Escalation is a delivery, not a failure: the episode and
diagnostic say exactly where the loop stood.

**Record, then continue.** Findings go into the plan's Decision Log as they happen (the live probe caught this,
the fixture caught that). Memory that only lives in the transcript is memory the next session does not have.

**Never silence a loop with `--no-verify`.** If the harness refuses, the refusal is the message; the repair path
exists for the rest.
