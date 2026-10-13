import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { assertFlags, flagValue, requireFlagValue } from "./cli-args.ts";
import { applyAction } from "./handoff-actions.ts";
import {
  changedPaths,
  currentBranch,
  currentRevision,
  taskFingerprint,
} from "./git.ts";
import {
  createApproval,
  HANDOFF_ACTIONS,
  markUncertain,
  readApproval,
  verifyApproval,
  writeApproval,
  type HandoffAction,
} from "./handoff.ts";
import { transition } from "./task.ts";
import { readTaskState, writeTaskState, type TaskState } from "./task-state.ts";
import { UsageError } from "./usage-error.ts";
import { readWorkspace } from "./workspace.ts";

const UNAVAILABLE_NOTE =
  "merge, deploy, migrate, and force-push are not available";

function parseAction(args: readonly string[]): HandoffAction {
  const action = flagValue(args, "--action") as HandoffAction | undefined;

  if (action === undefined || !HANDOFF_ACTIONS.includes(action)) {
    throw new UsageError(
      `handoff dry-run needs --action commit|push|draft-pr (${UNAVAILABLE_NOTE})`,
    );
  }

  return action;
}

/** A completed handoff is a phase, not a note: the task is done until it is re-verified. */
function markHandedOff(
  root: string,
  taskId: string,
  subcommand: "commit" | "push" | "draft-pr",
): void {
  const state = readTaskState(root, taskId);

  if (state?.phase !== "ready_for_review") return;

  writeTaskState(
    root,
    transition(state, "handed_off", {
      reason: `handoff ${subcommand} applied`,
    }),
  );
}

/** The action itself, with the refusal handling the dry-run path shares. */
export type HandoffContext = Readonly<{
  /** Where git runs: the task's workspace when it has one, otherwise the repository root. */
  cwd: string;
  branch: string;
  workspacePath: string | undefined;
}>;

/**
 * The handoff happens where the task lives. A task with a prepared workspace hands off *inside* it, so the
 * commit lands on `cfkit/<taskId>`; a single-tree task hands off in the repository, as before. Either way the
 * approval is bound to the branch and to the workspace it was issued in.
 */
export function handoffContext(root: string, taskId: string): HandoffContext {
  const workspace = readWorkspace(root, taskId);
  const prepared = workspace?.state === "prepared" ? workspace : undefined;
  const cwd = prepared === undefined ? root : join(root, prepared.path);

  return {
    cwd,
    branch: currentBranch(cwd),
    workspacePath: prepared?.path,
  };
}

function requireTask(
  root: string,
  taskId: string | undefined,
  verified: boolean,
): TaskState | undefined {
  const state = taskId === undefined ? undefined : readTaskState(root, taskId);

  if (state === undefined) {
    console.error(`[cfkit] unknown task "${taskId ?? ""}"`);

    return undefined;
  }

  if (verified && state.phase !== "ready_for_review") {
    console.error(
      `[cfkit] task "${state.taskId}" is "${state.phase}"; handoff requires a task in ready_for_review`,
    );

    return undefined;
  }

  return state;
}

export function scopedPaths(
  root: string,
  scopeFlag: string | undefined,
): readonly string[] {
  const actual = changedPaths(root);

  if (scopeFlag === undefined) return actual;

  const requested = scopeFlag
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  if (requested.length === 0) {
    throw new Error("--paths was given but lists no paths");
  }

  const missing = requested.filter((path) => !actual.includes(path));

  if (missing.length > 0) {
    throw new Error(
      `--paths contains paths that are not currently changed: ${missing.join(", ")}`,
    );
  }

  return [...requested].sort();
}

function runDryRun(args: readonly string[], root: string): number {
  assertFlags(
    args.slice(1),
    { "--task": "value", "--action": "value", "--paths": "value" },
    { maxPositionals: 0 },
  );

  const taskId = requireFlagValue(args, "--task");
  const action = parseAction(args);

  if (requireTask(root, taskId, true) === undefined) return 1;

  const challenge = randomBytes(32).toString("hex");
  const context = handoffContext(root, taskId);
  const scope = scopedPaths(context.cwd, flagValue(args, "--paths"));
  const approval = createApproval({
    taskId,
    action,
    changedPaths: scope,
    taskFingerprint: taskFingerprint(context.cwd),
    branch: context.branch,
    ...(context.workspacePath === undefined
      ? {}
      : { workspacePath: context.workspacePath }),
    challenge,
    nowMs: Date.now(),
  });

  writeApproval(root, approval);

  console.log(
    `[cfkit] handoff dry-run: ${taskId}; ${action}; ${String(approval.changedPaths.length)} of ${String(changedPaths(context.cwd).length)} changed paths${flagValue(args, "--paths") === undefined ? "" : " (scoped by --paths)"}; branch ${context.branch}${context.workspacePath === undefined ? "" : `; workspace ${context.workspacePath}`}`,
  );
  for (const path of approval.changedPaths) console.log(`  ${path}`);
  console.log(`  expires ${new Date(approval.expiresAt).toISOString()}`);
  console.log(`Approval: ${challenge}`);

  return 0;
}

function runMutation(
  root: string,
  subcommand: "commit" | "push" | "draft-pr",
  args: readonly string[],
  taskId: string,
  challenge: string,
): number {
  const approval = readApproval(root, taskId, subcommand);
  const context = handoffContext(root, taskId);
  const verdict = verifyApproval({
    approval,
    action: subcommand,
    challenge,
    nowMs: Date.now(),
    changedPaths: scopedPaths(context.cwd, flagValue(args, "--paths")),
    taskFingerprint: taskFingerprint(context.cwd),
    branch: context.branch,
    ...(context.workspacePath === undefined
      ? {}
      : { workspacePath: context.workspacePath }),
  });

  if (!verdict.ok) {
    console.error(`[cfkit] handoff refused: ${verdict.reason}`);

    return 1;
  }

  const approvedPaths = approval?.changedPaths ?? [];
  const status = applyAction(context.cwd, subcommand, args, approvedPaths);

  if (status !== 0 && approval !== undefined) {
    writeApproval(root, markUncertain(approval));
    console.error(
      "[cfkit] approval marked uncertain; inspect local and remote state before any retry",
    );
  }

  if (status === 0) {
    markHandedOff(root, taskId, subcommand);

    console.log(
      `[cfkit] handoff ${subcommand} applied; revision ${currentRevision(root)}`,
    );
  }

  return status;
}

const MUTATION_FLAGS: Readonly<
  Record<"commit" | "push" | "draft-pr", Readonly<Record<string, "value">>>
> = {
  commit: {
    "--task": "value",
    "--challenge": "value",
    "--message": "value",
    "--paths": "value",
  },
  push: { "--task": "value", "--challenge": "value" },
  "draft-pr": {
    "--task": "value",
    "--challenge": "value",
    "--title": "value",
    "--paths": "value",
  },
};

function assertMutationFlags(
  subcommand: "commit" | "push" | "draft-pr",
  args: readonly string[],
): Readonly<{ taskId: string; challenge: string }> {
  assertFlags(args.slice(1), MUTATION_FLAGS[subcommand], {
    maxPositionals: 0,
  });

  const taskId = requireFlagValue(args, "--task");
  const challenge = requireFlagValue(args, "--challenge");

  // Validate every flag the mutation itself needs before an approval is read:
  // a syntax error must never invalidate a valid, expiring handoff grant.
  if (subcommand === "commit") {
    requireFlagValue(args, "--message");
  }

  return { taskId, challenge };
}

export function runHandoff(args: readonly string[], root: string): number {
  const subcommand = args[0];

  if (subcommand === "dry-run") {
    try {
      return runDryRun(args, root);
    } catch (error) {
      if (error instanceof UsageError) throw error;

      const message = error instanceof Error ? error.message : String(error);

      console.error(`[cfkit] handoff refused: ${message}`);

      return 1;
    }
  }

  if (
    subcommand !== "commit" &&
    subcommand !== "push" &&
    subcommand !== "draft-pr"
  ) {
    throw new UsageError(
      `"${subcommand ?? ""}" is not available; ${UNAVAILABLE_NOTE}`,
    );
  }

  const { taskId, challenge } = assertMutationFlags(subcommand, args);

  try {
    return runMutation(root, subcommand, args, taskId, challenge);
  } catch (error) {
    if (error instanceof UsageError) throw error;

    const message = error instanceof Error ? error.message : String(error);

    console.error(`[cfkit] handoff refused: ${message}`);

    return 1;
  }
}
