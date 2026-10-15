# The agent loop

The attempt cycle, phase by phase. Each phase has an owner, a cost and an exit.

```
authorized ──► preparing ──► running ──► verifying ──┬──► ready_for_review ──► handed_off
     │              │            │            │       │
     │              │            │            └───────┴──► repairing ──► running …
     │              │            │                          │
     └──────────────┴────────────┴──► cancelled              └──► escalated (repair limit)
```

1. **authorized** — `task begin` bound the plan: authority hash, allowed paths/actions, maximum risk, budgets,
   repository identity and base revision. Nothing has run.
2. **preparing** — where a workspace is prepared (D15) or the single tree is accepted as it is.
3. **running** — the lane profile executes under the plan's timeout, checked before each step. An episode and a
   diagnostic are written per attempt, sanitized and private.
4. **verifying** — the profile's result decides the next phase; a preflight failure is recorded as a failure with
   code `task.preflight`, not merely printed.
5. **repairing** — a failed attempt lands here. Repeats are counted **per failure fingerprint**
   (`sha256(stepId:code)`), so two different failures do not share one budget.
6. **ready_for_review | escalated** — every step passed, or a budget ran out (`task.repair-limit`,
   `task.timeout`). Both are terminal-ish: review leads to a handoff, escalation needs a human.
7. **handed_off** — a bound approval performed exactly one action (commit, push, draft PR) and the task closed.

**Costs.** Preflight is ~200 ms and can refuse work that would have burned a lane run. An episode is a few
hundred bytes. A repair round costs one lane profile. Guessing costs everything the lane would have cost, plus a
wrong answer.

**What the loop never does.** It does not commit, push, merge or deploy without an approval bound to the exact
revision, paths, branch and workspace; and it does not edit the repository to make a gate pass.
