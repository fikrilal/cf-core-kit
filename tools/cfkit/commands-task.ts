import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assertFlags, requireFlagValue } from "./cli-args.ts";
import { runTaskWorkspace } from "./commands-workspace.ts";
import { recordAttempt } from "./episodes.ts";
import { changedPaths, currentRevision, repositoryIdentity } from "./git.ts";
import { evaluatePreflight, readPlanSource } from "./preflight.ts";
import { expandProfile } from "./profiles.ts";
import { defaultStepRunner, runProfile, type StepRunner } from "./runner.ts";
import { beginTask, recordFailure, recordSuccess, transition } from "./task.ts";
import {
  isTerminal,
  readTaskState,
  writeTaskState,
  type TaskState,
} from "./task-state.ts";
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
  console.log(`  phase           ${state.phase}`);
  if (state.stopReason !== undefined) {
    console.log(`  stop reason     ${state.stopReason}`);
  }
  console.log(`  declared risk   ${state.declaredRisk}`);
  console.log(
    `  effective risk  ${state.effectiveRisk} (max ${state.maximumRisk})`,
  );
  console.log(`  lane            ${state.lane}`);
  console.log(`  authority       ${state.authority.join(", ") || "unbound"}`);
  console.log(
    `  attempt         ${String(state.attempt)}/${String(state.repairLimit)}`,
  );
  for (const failure of state.failures) {
    console.log(
      `  failing         ${failure.stepId} ${failure.code} x${String(failure.repeatCount)} (${failure.fingerprint.slice(0, 12)}…)`,
    );
  }

  const recent = state.history.slice(-3);

  for (const entry of recent) {
    console.log(
      `  ${entry.from} -> ${entry.to}${entry.reason === undefined ? "" : ` (${entry.reason})`}`,
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
    repositoryIdentity: repositoryIdentity(root),
    baseRevision: currentRevision(root),
  });

  writeTaskState(root, state);
  printTaskState(state);

  return 0;
}

function preflightFor(
  root: string,
  state: TaskState,
  action: string,
): ReturnType<typeof evaluatePreflight> {
  return evaluatePreflight(
    state,
    {
      planSource: readPlanSource(root, state.planPath),
      planPath: state.planPath,
      changedPaths: changedPaths(root),
      repositoryIdentity: repositoryIdentity(root),
      currentRevision: currentRevision(root),
    },
    action,
  );
}

function runTaskPreflight(
  args: readonly string[],
  root: string,
  action: string,
): number {
  const lookup = lookupTask(args, root);

  if (!lookup.ok) return lookup.exitCode;

  const report = preflightFor(root, lookup.state, action);

  console.log(
    `[preflight] task ${lookup.state.taskId} action ${action}: ${report.problems.length === 0 ? "ok" : "refused"}`,
  );
  console.log(
    `[preflight] paths ${String(report.taskPaths.length)} in scope · effective risk ${report.effectiveRisk}`,
  );
  for (const note of report.notes) console.log(`[preflight] note: ${note}`);

  if (report.problems.length === 0) {
    console.log("[preflight] all checks passed");

    return 0;
  }

  console.error("[preflight] refusals:");

  for (const problem of report.problems) console.error(`  x ${problem}`);

  return 1;
}

/** The task's own budget: checked before each step and once more after the last one. */
function deadlineStepRunner(deadline: number): StepRunner {
  return async (script: string) => {
    if (Date.now() > deadline) {
      return {
        exitCode: 124,
        output: "task timeout exceeded before the step started",
      };
    }

    return defaultStepRunner(script);
  };
}

async function runTaskVerify(
  args: readonly string[],
  root: string,
): Promise<number> {
  const lookup = lookupTask(args, root);

  if (!lookup.ok) return lookup.exitCode;

  const state = lookup.state;

  if (isTerminal(state.phase)) {
    console.error(
      `[cfkit] task "${state.taskId}" is ${state.phase}; a terminal task cannot be verified again`,
    );

    return 1;
  }

  const report = preflightFor(root, state, "verify");

  if (report.problems.length > 0) {
    return refusePreflight(root, state, report.problems);
  }

  const inspecting = beginRun(state);
  const deadline = Date.now() + inspecting.taskTimeoutSeconds * 1_000;
  const result = await runProfile(
    { name: inspecting.lane, steps: expandProfile(inspecting.lane) },
    deadlineStepRunner(deadline),
  );
  const timedOut = Date.now() > deadline;
  const attempt = recordAttempt(root, {
    taskId: inspecting.taskId,
    attempt: inspecting.attempt + 1,
    lane: inspecting.lane,
    durationMs: result.durationMs,
    steps: result.results,
  });

  console.log(
    `[cfkit] episode ${attempt.episodePath} · diagnostics ${attempt.diagnosticsPath}`,
  );

  const verifying = transition(inspecting, "verifying", {
    reason: timedOut ? "task timeout reached" : "profile finished",
  });

  if (timedOut) return escalateTimeout(root, inspecting, verifying);

  if (result.exitCode !== 0) {
    return finishFailure(root, verifying, result);
  }

  const next = transition(recordSuccess(verifying), "ready_for_review", {
    reason: "every step passed",
  });

  writeTaskState(root, next);
  printTaskState(next);

  return 0;
}

/**
 * The run's opening hops. A task that already ran (and failed) resumes from `repairing`; a fresh one goes
 * through `preparing`, which is where D15's workspaces will do their work.
 */
function beginRun(state: TaskState): TaskState {
  if (state.phase === "repairing") {
    return transition(state, "running", { reason: "repair attempt" });
  }

  return transition(
    transition(state, "preparing", {
      reason: "preflight passed; nothing to prepare in the single-tree flow",
    }),
    "running",
  );
}

/** A failed attempt lands in `repairing`, so the next run is a repair and repeats count against the limit. */
function finishFailure(
  root: string,
  verifying: TaskState,
  result: Readonly<{
    exitCode: number;
    results: readonly Readonly<{
      id: string;
      descriptor?: Readonly<{ code: string }>;
    }>[];
  }>,
): number {
  const failed = result.results.at(-1);
  const repairing =
    verifying.phase === "verifying"
      ? transition(verifying, "repairing", { reason: "attempt failed" })
      : verifying;
  const next = recordFailure(repairing, {
    stepId: failed?.id ?? "unknown",
    code: failed?.descriptor?.code ?? "harness.unknown-step",
  });

  writeTaskState(root, next);
  printTaskState(next);

  if (next.phase === "escalated") {
    console.error("[cfkit] Repair budget exhausted; request human direction.");
  }

  return result.exitCode;
}

function refusePreflight(
  root: string,
  state: TaskState,
  problems: readonly string[],
): number {
  const next = recordFailure(state, {
    stepId: "preflight",
    code: "task.preflight",
  });

  writeTaskState(root, next);
  console.error("[preflight] refusals:");

  for (const problem of problems) console.error(`  x ${problem}`);
  printTaskState(next);

  return 1;
}

/** A timeout is a stop reason, not a silent failure: the task escalates and says why. */
function escalateTimeout(
  root: string,
  state: TaskState,
  stoppedIn: TaskState,
): number {
  const next = transition(recordSuccess(stoppedIn), "escalated", {
    reason: "task timeout exceeded",
    stopReason: "task.timeout",
  });

  writeTaskState(root, next);
  printTaskState(next);
  console.error(
    `[cfkit] Task timeout (${String(state.taskTimeoutSeconds)}s) exceeded; request human direction.`,
  );

  return 1;
}

function runTaskStatus(args: readonly string[], root: string): number {
  const lookup = lookupTask(args, root);

  if (!lookup.ok) return lookup.exitCode;

  printTaskState(lookup.state);

  return 0;
}

function runTaskCancel(args: readonly string[], root: string): number {
  const lookup = lookupTask(args, root);

  if (!lookup.ok) return lookup.exitCode;

  const next = transition(lookup.state, "cancelled", {
    reason: "cancelled by the operator",
  });

  writeTaskState(root, next);
  printTaskState(next);

  return 0;
}

export async function runTask(
  args: readonly string[],
  root: string,
): Promise<number> {
  const subcommand = args[0];

  try {
    if (subcommand === "begin") return runTaskBegin(args, root);
    if (subcommand === "preflight") {
      return runTaskPreflight(args, root, "verify");
    }
    if (subcommand === "verify") return await runTaskVerify(args, root);
    if (subcommand === "status") return runTaskStatus(args, root);
    if (subcommand === "workspace") {
      return runTaskWorkspace(args.slice(1), root);
    }
    if (subcommand === "cancel") return runTaskCancel(args, root);
  } catch (error) {
    if (error instanceof UsageError) throw error;

    const message = error instanceof Error ? error.message : String(error);

    console.error(`[cfkit] task refused: ${message}`);

    return 1;
  }

  throw new UsageError(
    `unknown task subcommand "${subcommand ?? ""}" (expected begin|preflight|verify|status|workspace|cancel)`,
  );
}
