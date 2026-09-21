import { readFileSync } from "node:fs";
import { join } from "node:path";

import { changedPaths } from "./git.ts";
import { expandProfile } from "./profiles.ts";
import { runProfile } from "./runner.ts";
import {
  beginTask,
  readTaskState,
  recordFailure,
  recordSuccess,
  writeTaskState,
  type TaskState,
} from "./task.ts";

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);

  return index === -1 ? undefined : args[index + 1];
}

function printTaskState(state: TaskState): void {
  console.log(`[cfkit] task ${state.taskId}`);
  console.log(`  plan            ${state.planPath}`);
  console.log(`  declared risk   ${state.declaredRisk}`);
  console.log(
    `  effective risk  ${state.effectiveRisk} (${state.rules.join(", ")})`,
  );
  console.log(`  lane            ${state.lane}`);
  console.log(`  status          ${state.status}`);
  console.log(
    `  attempt         ${String(state.attempt)}/${String(state.repairLimit)}`,
  );
  for (const failure of state.failures) {
    console.log(
      `  failing         ${failure.stepId} x${String(failure.repeatCount)}`,
    );
  }
}

function runTaskBegin(args: readonly string[], root: string): number {
  const planPath = flagValue(args, "--plan");

  if (planPath === undefined) {
    console.error("[cfkit] task begin needs --plan <path>");

    return 1;
  }

  const state = beginTask({
    root,
    planPath,
    planSource: readFileSync(join(root, planPath), "utf8"),
    changedPaths: changedPaths(root),
  });

  writeTaskState(root, state);
  printTaskState(state);

  return 0;
}

function runTaskVerify(args: readonly string[], root: string): number {
  const taskId = flagValue(args, "--task");
  const state = taskId === undefined ? undefined : readTaskState(root, taskId);

  if (taskId === undefined || state === undefined) {
    console.error(`[cfkit] unknown task "${taskId ?? ""}"`);

    return 1;
  }

  const result = runProfile({
    name: state.lane,
    steps: expandProfile(state.lane),
  });

  if (result.exitCode !== 0) {
    const failed = result.results.at(-1);
    const next = recordFailure(state, failed?.id ?? "unknown");

    writeTaskState(root, next);
    printTaskState(next);

    if (next.status === "escalated") {
      console.error(
        "[cfkit] Repair budget exhausted; request human direction.",
      );
    }

    return result.exitCode;
  }

  const next = recordSuccess(state);

  writeTaskState(root, next);
  printTaskState(next);

  return 0;
}

function runTaskStatus(args: readonly string[], root: string): number {
  const taskId = flagValue(args, "--task");
  const state = taskId === undefined ? undefined : readTaskState(root, taskId);

  if (state === undefined) {
    console.error(`[cfkit] unknown task "${taskId ?? ""}"`);

    return 1;
  }

  printTaskState(state);

  return 0;
}

export function runTask(args: readonly string[], root: string): number {
  const subcommand = args[0];

  try {
    if (subcommand === "begin") return runTaskBegin(args, root);
    if (subcommand === "verify") return runTaskVerify(args, root);
    if (subcommand === "status") return runTaskStatus(args, root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[cfkit] task refused: ${message}`);

    return 1;
  }

  console.error(
    `[cfkit] unknown task subcommand "${subcommand ?? ""}" (expected begin|verify|status)`,
  );

  return 1;
}
