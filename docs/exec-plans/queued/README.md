# Queued plans

Plans that are written but not started live here. A queued plan is a full plan (the same contract as
`docs/exec-plans/README.md` describes) whose header reads `- Status: queued`; it is promoted into `../active/`
by the intake:

```bash
npm run cfkit -- events run --once            # promote one plan (refuses if active/ is occupied)
npm run cfkit -- events run --once --dry-run  # report what would happen, write nothing
```

The intake is conservative on purpose:

- Nothing is promoted while a file sits in `../active/` or while a task is tracked under `.cfkit/tasks/`.
- The plan must pass the plan contract **as an active plan**, metadata block included; a queued plan that would
  not survive promotion is refused with the contract's own problems.
- Every promotion writes a receipt under `.cfkit/events/` (mode 0600) whose identity is the source path, the
  task id and a hash of the queued bytes — so the same plan re-edited is a new event, and the same revision
  cannot be promoted twice. A run that dies between claiming and moving is recovered on the next run.

This folder is allowed to be empty; `npm run plans:check` treats both an absent and an empty queue as a normal
state.
