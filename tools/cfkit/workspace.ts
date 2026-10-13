import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { acquireLock, releaseLock } from "./lock.ts";
import { statePath, type TaskState } from "./task-state.ts";

/**
 * Isolated workspaces: a linked worktree per task, so two tasks can run at once without sharing a working
 * tree. A workspace is a *choice* — a task without one keeps the single-tree flow — and it is bound to the
 * state it was prepared for: task id, plan path, authority hash and base revision must all still match, or the
 * workspace is stale and refusing is the only safe answer.
 */
export const WORKSPACES_DIRECTORY = ".cfkit/worktrees";
export const WORKSPACE_STATE_VERSION = 1;
export const WORKSPACE_BRANCH_PREFIX = "cfkit/";
export const WORKSPACE_STATE_MODE = 0o600;

export type Workspace = Readonly<{
  schemaVersion: number;
  taskId: string;
  planPath: string;
  authorityHash: string;
  baseRevision: string;
  branch: string;
  path: string;
  createdAt: string;
  state: "prepared" | "released";
}>;

export type GitRunner = (args: readonly string[]) => Readonly<{
  status: number;
  stdout: string;
  stderr: string;
}>;

export function defaultGitRunner(root: string): GitRunner {
  return (args) => {
    const result = spawnSync("git", [...args], { cwd: root, encoding: "utf8" });

    return {
      status: typeof result.status === "number" ? result.status : 1,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
    };
  };
}

export function workspaceBranch(taskId: string): string {
  return `${WORKSPACE_BRANCH_PREFIX}${taskId}`;
}

export function workspacePath(taskId: string): string {
  return `${WORKSPACES_DIRECTORY}/${taskId}`;
}

export function workspaceStatePath(taskId: string): string {
  return join(dirname(statePath(taskId)), "workspace.json");
}

export function readWorkspace(
  root: string,
  taskId: string,
): Workspace | undefined {
  const path = join(root, workspaceStatePath(taskId));

  if (!existsSync(path)) return undefined;

  return JSON.parse(readFileSync(path, "utf8")) as Workspace;
}

export function writeWorkspace(root: string, workspace: Workspace): string {
  const relative = workspaceStatePath(workspace.taskId);
  const path = join(root, relative);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(workspace, null, 2)}\n`, {
    mode: WORKSPACE_STATE_MODE,
  });

  return relative;
}

export function removeWorkspaceState(root: string, taskId: string): void {
  rmSync(join(root, workspaceStatePath(taskId)), { force: true });
}

/** The workspace must still describe the task it was prepared for; anything else is stale. */
export function validateWorkspace(
  workspace: Workspace,
  state: TaskState,
): readonly string[] {
  const problems: string[] = [];

  if (workspace.schemaVersion !== WORKSPACE_STATE_VERSION) {
    problems.push(
      `workspace schema ${String(workspace.schemaVersion)} is not ${String(WORKSPACE_STATE_VERSION)}`,
    );
  }
  if (workspace.taskId !== state.taskId) {
    problems.push(
      `workspace belongs to task "${workspace.taskId}", not "${state.taskId}"`,
    );
  }
  if (workspace.planPath !== state.planPath) {
    problems.push(
      `workspace was prepared for plan ${workspace.planPath}, the task now points at ${state.planPath}`,
    );
  }
  if (workspace.authorityHash !== state.authorityHash) {
    problems.push(
      "workspace was prepared under a different authority; re-begin the task or re-prepare the workspace",
    );
  }
  if (workspace.baseRevision !== state.baseRevision) {
    problems.push(
      `workspace was prepared at revision ${workspace.baseRevision.slice(0, 12)}…, the task began at ${state.baseRevision.slice(0, 12)}…`,
    );
  }
  if (workspace.branch !== workspaceBranch(state.taskId)) {
    problems.push(`workspace branch must be ${workspaceBranch(state.taskId)}`);
  }

  return problems;
}

export type PrepareResult =
  | Readonly<{ ok: true; workspace: Workspace }>
  | Readonly<{ ok: false; problems: readonly string[] }>;

export function prepareWorkspace(
  root: string,
  state: TaskState,
  options: Readonly<{ git?: GitRunner; now?: Date }> = {},
): PrepareResult {
  const git = options.git ?? defaultGitRunner(root);
  const branch = workspaceBranch(state.taskId);
  const path = workspacePath(state.taskId);
  const absolute = join(root, path);
  const problems: string[] = [];

  if (existsSync(absolute)) {
    problems.push(
      `${path} already exists; run \`task workspace cleanup\` first`,
    );
  }

  const branches = git(["branch", "--list", branch]).stdout.trim();

  if (branches !== "") {
    problems.push(`branch ${branch} already exists`);
  }

  const prepared = preparedWorkspaces(root);
  const ownPrepared = prepared.includes(state.taskId);
  const otherPrepared = prepared.filter((entry) => entry !== state.taskId);

  if (ownPrepared) {
    problems.push(
      `task "${state.taskId}" already has a prepared workspace; run \`task workspace cleanup\` first`,
    );
  }
  if (otherPrepared.length > 0) {
    problems.push(
      `another task already holds a workspace: ${otherPrepared.join(", ")}`,
    );
  }

  if (problems.length > 0) return { ok: false, problems };

  const lock = acquireLock(root, {
    command: `task workspace prepare ${state.taskId}`,
  });

  if (!lock.ok) return { ok: false, problems: [lock.reason] };

  try {
    const created = git([
      "worktree",
      "add",
      "-b",
      branch,
      path,
      state.baseRevision,
    ]);

    if (created.status !== 0) {
      return {
        ok: false,
        problems: [`git worktree add failed: ${created.stderr.trim()}`],
      };
    }
  } finally {
    releaseLock(root, lock.handle);
  }

  const workspace: Workspace = {
    schemaVersion: WORKSPACE_STATE_VERSION,
    taskId: state.taskId,
    planPath: state.planPath,
    authorityHash: state.authorityHash,
    baseRevision: state.baseRevision,
    branch,
    path,
    createdAt: (options.now ?? new Date()).toISOString(),
    state: "prepared",
  };

  writeWorkspace(root, workspace);

  return { ok: true, workspace };
}

/** Task ids that currently hold a prepared workspace, by reading the recorded manifests. */
export function preparedWorkspaces(root: string): readonly string[] {
  const directory = join(root, ".cfkit", "tasks");

  if (!existsSync(directory)) return [];

  const prepared: string[] = [];

  for (const entry of listTasks(directory)) {
    const workspace = readWorkspace(root, entry);

    if (workspace?.state === "prepared") prepared.push(entry);
  }

  return prepared;
}

function listTasks(directory: string): readonly string[] {
  return existsSync(directory) ? readdirSync(directory) : [];
}

export function cleanupWorkspace(
  root: string,
  state: TaskState,
  options: Readonly<{ git?: GitRunner }> = {},
): readonly string[] {
  const git = options.git ?? defaultGitRunner(root);
  const workspace = readWorkspace(root, state.taskId);
  const problems: string[] = [];

  if (workspace === undefined) {
    problems.push(`no workspace is recorded for task "${state.taskId}"`);

    return problems;
  }

  const lock = acquireLock(root, {
    command: `task workspace cleanup ${state.taskId}`,
  });

  if (!lock.ok) return [lock.reason];

  try {
    if (existsSync(join(root, workspace.path))) {
      const removed = git(["worktree", "remove", "--force", workspace.path]);

      if (removed.status !== 0) {
        problems.push(`git worktree remove failed: ${removed.stderr.trim()}`);
      }
    }

    const deleted = git(["branch", "-D", workspace.branch]);

    if (deleted.status !== 0) {
      problems.push(`git branch -D failed: ${deleted.stderr.trim()}`);
    }

    git(["worktree", "prune"]);
  } finally {
    releaseLock(root, lock.handle);
  }

  if (problems.length === 0) {
    writeWorkspace(root, { ...workspace, state: "released" });
  }

  return problems;
}
