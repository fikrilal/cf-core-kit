import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runTaskWorkspace } from "./commands-workspace.ts";
import { acquireLock, releaseLock, LOCK_PATH } from "./lock.ts";
import { beginTask } from "./task.ts";
import { writeTaskState, type TaskState } from "./task-state.ts";
import {
  cleanupWorkspace,
  prepareWorkspace,
  type PrepareResult,
  preparedWorkspaces,
  readWorkspace,
  validateWorkspace,
  workspaceBranch,
  workspacePath,
  writeWorkspace,
  WORKSPACE_STATE_MODE,
  type GitRunner,
  type Workspace,
} from "./workspace.ts";

const PLAN_PATH = "docs/exec-plans/active/2026-10-11_sample-task.md";
const PLAN_SOURCE = `# Sample

- Status: active
- Owner: fikrilal
- Task ID: sample-task
- Risk: low
- Maximum risk: medium
- Authority: edit, verify
- Repair limit: 2
- Task timeout: 30m
- Date: 2026-10-11
- Impact areas: Harness/CI: yes
- Allowed paths: tools/cfkit
- Allowed actions: edit, verify

## Objective

x

## Verification

y
`;

interface GitCall {
  args: readonly string[];
}

function recordingGit(
  responses: Readonly<
    Record<
      string,
      Readonly<{ status: number; stdout?: string; stderr?: string }>
    >
  > = {},
): Readonly<{ git: GitRunner; calls: GitCall[] }> {
  const calls: GitCall[] = [];
  const git: GitRunner = (args) => {
    calls.push({ args });

    const key = args.join(" ");
    const response = responses[key] ?? { status: 0, stdout: "", stderr: "" };

    return {
      status: response.status,
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
    };
  };

  return { git, calls };
}

/** Narrowing lives here, so the assertions can read straight through. */
function refusal(result: PrepareResult): readonly string[] {
  if (result.ok) throw new Error("expected the workspace operation to refuse");

  return result.problems;
}

function prepared(result: PrepareResult): Workspace {
  if (!result.ok)
    throw new Error(`expected the workspace: ${result.problems.join("; ")}`);

  return result.workspace;
}

function fixture(): Readonly<{ root: string; state: TaskState }> {
  const root = mkdtempSync(join(tmpdir(), "cfkit-workspace-"));
  const state = beginTask({
    root,
    planPath: PLAN_PATH,
    planSource: PLAN_SOURCE,
    changedPaths: [],
    repositoryIdentity: "identity-1",
    baseRevision: "a".repeat(40),
  });

  writeTaskState(root, state);

  return { root, state };
}

test("workspace: prepare creates the worktree, the branch and a private manifest", () => {
  const { root, state } = fixture();

  try {
    const { git, calls } = recordingGit();
    const result = prepareWorkspace(root, state, {
      git,
      now: new Date("2026-10-14T00:00:00.000Z"),
    });

    const workspace = prepared(result);

    assert.deepEqual(calls[0]?.args, ["branch", "--list", "cfkit/sample-task"]);
    assert.deepEqual(calls[1]?.args, [
      "worktree",
      "add",
      "-b",
      "cfkit/sample-task",
      workspacePath("sample-task"),
      state.baseRevision,
    ]);
    assert.equal(workspace.branch, workspaceBranch("sample-task"));
    assert.equal(workspace.authorityHash, state.authorityHash);
    assert.equal(workspace.state, "prepared");
    assert.equal(
      statSync(join(root, ".cfkit", "tasks", "sample-task", "workspace.json"))
        .mode & 0o777,
      WORKSPACE_STATE_MODE,
    );
    assert.deepEqual(preparedWorkspaces(root), ["sample-task"]);
    assert.deepEqual(validateWorkspace(workspace, state), []);
    assert.equal(existsSync(join(root, LOCK_PATH)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace: prepare refuses an existing path, an existing branch or another claim", () => {
  const { root, state } = fixture();

  try {
    mkdirSync(join(root, workspacePath("sample-task")), { recursive: true });

    const taken = prepareWorkspace(root, state, { git: recordingGit().git });

    assert.match(
      refusal(taken)[0] ?? "",
      /already exists; run `task workspace cleanup` first/,
    );

    rmSync(join(root, workspacePath("sample-task")), { recursive: true });

    const branchTaken = prepareWorkspace(root, state, {
      git: recordingGit({
        "branch --list cfkit/sample-task": {
          status: 0,
          stdout: "cfkit/sample-task\n",
        },
      }).git,
    });

    assert.match(
      refusal(branchTaken)[0] ?? "",
      /branch cfkit\/sample-task already exists/,
    );

    // Another task's prepared workspace blocks a second one.
    const other = beginTask({
      root,
      planPath: "docs/exec-plans/active/2026-10-11_other-task.md",
      planSource: PLAN_SOURCE.replace(
        "Task ID: sample-task",
        "Task ID: other-task",
      ),
      changedPaths: [],
      repositoryIdentity: "identity-1",
      baseRevision: "a".repeat(40),
    });

    writeTaskState(root, other);
    writeWorkspace(root, {
      schemaVersion: 1,
      taskId: "other-task",
      planPath: other.planPath,
      authorityHash: other.authorityHash,
      baseRevision: other.baseRevision,
      branch: "cfkit/other-task",
      path: workspacePath("other-task"),
      createdAt: "2026-10-14T00:00:00.000Z",
      state: "prepared",
    });

    const blocked = prepareWorkspace(root, state, { git: recordingGit().git });

    assert.match(
      refusal(blocked)[0] ?? "",
      /another task already holds a workspace: other-task/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace: a live lock refuses prepare, and cleanup restores the repository", () => {
  const { root, state } = fixture();

  try {
    const held = acquireLock(root, { command: "someone else" });

    if (!held.ok) throw new Error("expected the lock");

    const blocked = prepareWorkspace(root, state, { git: recordingGit().git });

    assert.match(refusal(blocked)[0] ?? "", /held by pid/);

    releaseLock(root, held.handle);

    const prepared = prepareWorkspace(root, state, { git: recordingGit().git });
    const second = prepareWorkspace(root, state, { git: recordingGit().git });

    assert.equal(prepared.ok, true);
    // The manifest now exists, so the second attempt refuses without touching git.
    assert.match(refusal(second)[0] ?? "", /already has a prepared workspace/);

    mkdirSync(join(root, workspacePath("sample-task")), { recursive: true });

    const { git, calls } = recordingGit();
    const problems = cleanupWorkspace(root, state, { git });

    assert.deepEqual(problems, []);
    assert.deepEqual(
      calls.map((call) => call.args.slice(0, 2)),
      [
        ["worktree", "remove"],
        ["branch", "-D"],
        ["worktree", "prune"],
      ],
    );
    assert.equal(readWorkspace(root, state.taskId)?.state, "released");
    assert.deepEqual(preparedWorkspaces(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace: cleanup reports git failures instead of pretending success", () => {
  const { root, state } = fixture();

  try {
    prepareWorkspace(root, state, { git: recordingGit().git });
    mkdirSync(join(root, workspacePath("sample-task")), { recursive: true });

    const problems = cleanupWorkspace(root, state, {
      git: recordingGit({
        "worktree remove --force .cfkit/worktrees/sample-task": {
          status: 1,
          stderr: "worktree is locked",
        },
      }).git,
    });

    assert.match(
      problems[0] ?? "",
      /git worktree remove failed: worktree is locked/,
    );
    assert.equal(readWorkspace(root, state.taskId)?.state, "prepared");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace: validation refuses every stale binding", () => {
  const { state } = fixture();
  const base: Workspace = {
    schemaVersion: 1,
    taskId: state.taskId,
    planPath: state.planPath,
    authorityHash: state.authorityHash,
    baseRevision: state.baseRevision,
    branch: workspaceBranch(state.taskId),
    path: workspacePath(state.taskId),
    createdAt: "2026-10-14T00:00:00.000Z",
    state: "prepared",
  };

  assert.deepEqual(validateWorkspace(base, state), []);

  const cases: readonly [Partial<Workspace>, RegExp][] = [
    [{ schemaVersion: 2 }, /workspace schema 2 is not 1/],
    [{ taskId: "someone-else" }, /belongs to task "someone-else"/],
    [{ planPath: "docs/exec-plans/active/other.md" }, /was prepared for plan/],
    [{ authorityHash: "f".repeat(64) }, /different authority/],
    [{ baseRevision: "b".repeat(40) }, /was prepared at revision bbbbbbbbbbbb/],
    [{ branch: "feature/x" }, /workspace branch must be cfkit\/sample-task/],
  ];

  for (const [overrides, pattern] of cases) {
    assert.ok(
      validateWorkspace({ ...base, ...overrides }, state).some((problem) =>
        pattern.test(problem),
      ),
      `${JSON.stringify(overrides)} must be refused`,
    );
  }
});

test("workspace: the command surface reports status and cancels without touching the worktree", () => {
  const { root, state } = fixture();

  try {
    assert.equal(runTaskWorkspace(["status", "--task", state.taskId], root), 0);
    assert.equal(
      runTaskWorkspace(["cancel", "--task", state.taskId], root),
      1,
      "cancelling a task without a workspace refuses",
    );

    prepareWorkspace(root, state, { git: recordingGit().git });
    mkdirSync(join(root, workspacePath("sample-task")), { recursive: true });

    assert.equal(runTaskWorkspace(["status", "--task", state.taskId], root), 0);

    const cancelled = runTaskWorkspace(
      ["cancel", "--task", state.taskId],
      root,
    );

    assert.equal(cancelled, 0);
    assert.equal(readWorkspace(root, state.taskId)?.state, "released");
    assert.equal(
      existsSync(join(root, workspacePath("sample-task"))),
      true,
      "cancel leaves the worktree for salvage",
    );

    assert.throws(
      () => runTaskWorkspace(["nope", "--task", state.taskId], root),
      /expected prepare\|status\|cancel\|cleanup/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("workspace: a manifest written by hand still round-trips", () => {
  const { root, state } = fixture();

  try {
    const workspace: Workspace = {
      schemaVersion: 1,
      taskId: state.taskId,
      planPath: state.planPath,
      authorityHash: state.authorityHash,
      baseRevision: state.baseRevision,
      branch: workspaceBranch(state.taskId),
      path: workspacePath(state.taskId),
      createdAt: "2026-10-14T00:00:00.000Z",
      state: "released",
    };
    const relative = writeWorkspace(root, workspace);

    assert.equal(
      relative,
      join(".cfkit", "tasks", "sample-task", "workspace.json"),
    );
    assert.deepEqual(readWorkspace(root, state.taskId), workspace);
    assert.deepEqual(preparedWorkspaces(root), []);
    assert.match(
      readFileSync(join(root, relative), "utf8"),
      /"taskId": "sample-task"/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
