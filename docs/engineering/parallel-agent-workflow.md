# Working in parallel

Two tasks, one repository. The question is never "can they run at once" but "what do they share".

**Start single-tree.** The default is one working tree, one task at a time. Most work is sequential, and a
worktree costs a checkout plus a mental model.

**Prepare a workspace when the second task is real.** `cfkit task workspace prepare --task <id>` creates a linked
worktree at `.cfkit/worktrees/<id>` on branch `cfkit/<id>` at the task's base revision, with a mode-0600
`workspace.json` binding the task id, plan path, authority hash and base revision. One workspace per repository at
a time: two prepared worktrees would let two tasks commit to the same branch namespace and the same ledger.

**What the workspace buys.** Git operations run _in_ it: `task verify` writes episodes under the same `.cfkit/`
task directory, `handoff commit` stages and commits on `cfkit/<id>`, and the main branch stays untouched — proven
by the D16 probe, where a tampered binding refused and the real commit never touched `main`.

**What stays shared.** The repository lock (mutations are serialized), the state under `.cfkit/`, the reviewed
baselines (a removal prunes them globally), and the contract: two tasks editing the same operation will still
conflict, and the second one should wait.

**Release the claim when you stop touching it.** `task workspace cancel` releases the claim and leaves the
worktree for salvage; `task workspace cleanup` removes the worktree and the branch. Both are explicit because
deleting uncommitted work is the one action that cannot be undone.

**When in doubt, serialize.** The harness's guards (active task, occupied `active/`, repository lock) exist to
turn "we will be careful" into "the tool will not let us".
