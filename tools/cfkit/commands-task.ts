import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assertFlags, requireFlagValue } from "./cli-args.ts";
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
import { UsageError } from "./usage-error.ts";

type TaskLookup =
  | Readonly<{ ok: true; state: TaskState }>
  | Readonly<{ ok: false; exitCode: number }>;

function lookupTask(args: readonly string[], root: string): TaskLookup {
  assertFlags(args.slice(1), { "--task": "value" }, { maxPositionals: 0 });

  const taskId = requireFlagValue(args, "--task");
  const state = readTaskState(root, taskId);

  if (state === undefined) {
    console.error(`[cfkit] unknown task "${taskId}"`);

    return { ok: false, exitCode: 1 };
  }

  return { ok: true, state };
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
  assertFlags(args.slice(1), { "--plan": "value" }, { maxPositionals: 0 });

  const planPath = requireFlagValue(args, "--plan");

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

async function runTaskVerify(
  args: readonly string[],
  root: string,
): Promise<number> {
  const lookup = lookupTask(args, root);

  if (!lookup.ok) return lookup.exitCode;

  const state = lookup.state;
  const result = await runProfile({
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
  const lookup = lookupTask(args, root);

  if (!lookup.ok) return lookup.exitCode;

  printTaskState(lookup.state);

  return 0;
}

export async function runTask(
  args: readonly string[],
  root: string,
): Promise<number> {
  const subcommand = args[0];

  try {
    if (subcommand === "begin") return runTaskBegin(args, root);
    if (subcommand === "verify") return await runTaskVerify(args, root);
    if (subcommand === "status") return runTaskStatus(args, root);
  } catch (error) {
    if (error instanceof UsageError) throw error;

    const message = error instanceof Error ? error.message : String(error);

    console.error(`[cfkit] task refused: ${message}`);

    return 1;
  }

  throw new UsageError(
    `unknown task subcommand "${subcommand ?? ""}" (expected begin|verify|status)`,
  );
}
