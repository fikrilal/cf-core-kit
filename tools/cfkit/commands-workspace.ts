import { existsSync } from "node:fs";
import { join } from "node:path";

import { assertFlags, requireFlagValue } from "./cli-args.ts";
import { readTaskState, type TaskState } from "./task-state.ts";
import { UsageError } from "./usage-error.ts";
import {
  cleanupWorkspace,
  defaultGitRunner,
  prepareWorkspace,
  readWorkspace,
  validateWorkspace,
  writeWorkspace,
} from "./workspace.ts";

function lookup(root: string, args: readonly string[]): TaskState | undefined {
  assertFlags(args.slice(1), { "--task": "value" }, { maxPositionals: 0 });

  const taskId = requireFlagValue(args, "--task");
  const state = readTaskState(root, taskId);

  if (state === undefined) {
    console.error(`[cfkit] unknown task "${taskId}"`);
  }

  return state;
}

function printWorkspace(
  root: string,
  state: TaskState,
  workspace: ReturnType<typeof readWorkspace>,
): void {
  if (workspace === undefined) {
    console.log(
      `[cfkit] task ${state.taskId}: no workspace (the single-tree flow is the default)`,
    );

    return;
  }

  console.log(`[cfkit] workspace ${state.taskId}`);
  console.log(`  state           ${workspace.state}`);
  console.log(`  path            ${workspace.path}`);
  console.log(`  branch          ${workspace.branch}`);
  console.log(`  base revision   ${workspace.baseRevision.slice(0, 12)}…`);
  console.log(
    `  present         ${String(existsSync(join(root, workspace.path)))}`,
  );

  const problems = validateWorkspace(workspace, state);

  for (const problem of problems) console.log(`  stale           ${problem}`);
}

export function runTaskWorkspace(
  args: readonly string[],
  root: string,
): number {
  const subcommand = args[0];
  const state = lookup(root, args);

  if (state === undefined) return 1;

  if (subcommand === "prepare") {
    const result = prepareWorkspace(root, state);

    if (!result.ok) {
      console.error("[cfkit] workspace prepare refused:");
      for (const problem of result.problems) console.error(`  x ${problem}`);

      return 1;
    }

    console.log(
      `[cfkit] workspace prepared at ${result.workspace.path} on ${result.workspace.branch}`,
    );

    return 0;
  }

  if (subcommand === "status") {
    printWorkspace(root, state, readWorkspace(root, state.taskId));

    return 0;
  }

  if (subcommand === "cancel") {
    const workspace = readWorkspace(root, state.taskId);

    if (workspace === undefined) {
      console.error(
        `[cfkit] no workspace is recorded for task "${state.taskId}"`,
      );

      return 1;
    }

    // Cancelling releases the claim without touching the worktree: salvage stays a human decision.
    writeWorkspace(root, { ...workspace, state: "released" });
    console.log(
      `[cfkit] workspace claim released; ${workspace.path} is left in place for salvage`,
    );

    return 0;
  }

  if (subcommand === "cleanup") {
    const problems = cleanupWorkspace(root, state);

    if (problems.length > 0) {
      console.error("[cfkit] workspace cleanup refused:");
      for (const problem of problems) console.error(`  x ${problem}`);

      return 1;
    }

    console.log(`[cfkit] workspace removed for task "${state.taskId}"`);

    return 0;
  }

  throw new UsageError(
    `unknown task workspace subcommand "${subcommand ?? ""}" (expected prepare|status|cancel|cleanup)`,
  );
}

export { defaultGitRunner };
