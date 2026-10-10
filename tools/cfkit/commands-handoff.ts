import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertFlags, flagValue, requireFlagValue } from "./cli-args.ts";
import {
  changedPaths,
  currentBranch,
  currentRevision,
  git,
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
  const scope = scopedPaths(root, flagValue(args, "--paths"));
  const approval = createApproval({
    taskId,
    action,
    changedPaths: scope,
    taskFingerprint: taskFingerprint(root),
    challenge,
    nowMs: Date.now(),
  });

  writeApproval(root, approval);

  console.log(
    `[cfkit] handoff dry-run: ${taskId}; ${action}; ${String(approval.changedPaths.length)} of ${String(changedPaths(root).length)} changed paths${flagValue(args, "--paths") === undefined ? "" : " (scoped by --paths)"}; branch ${currentBranch(root)}`,
  );
  for (const path of approval.changedPaths) console.log(`  ${path}`);
  console.log(`  expires ${new Date(approval.expiresAt).toISOString()}`);
  console.log(`Approval: ${challenge}`);

  return 0;
}

function stageApprovedPaths(root: string, paths: readonly string[]): void {
  git(["add", "--", ...paths], root);

  const staged = git(["diff", "--cached", "--name-only"], root)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .sort();
  const expected = [...paths].sort();

  if (
    staged.length !== expected.length ||
    staged.some((path, index) => path !== expected[index])
  ) {
    throw new Error(
      "staged changes outside the approved paths; refusing to commit",
    );
  }
}

function runCommit(
  root: string,
  args: readonly string[],
  approvalPaths: readonly string[],
): number {
  const message = requireFlagValue(args, "--message");

  stageApprovedPaths(root, approvalPaths);

  const commit = spawnSync("git", ["commit", "-m", message], {
    cwd: root,
    stdio: "inherit",
  });

  if (commit.status !== 0) {
    console.error(
      "[cfkit] commit failed; inspect local state before any retry",
    );

    return commit.status ?? 1;
  }

  return 0;
}

function runPush(root: string): number {
  const remote = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: root,
    encoding: "utf8",
  });

  if (remote.status !== 0) {
    console.error("[cfkit] no origin remote configured");

    return 1;
  }

  const branch = currentBranch(root);
  const push = spawnSync(
    "git",
    ["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`],
    { cwd: root, stdio: "inherit" },
  );

  if (push.status !== 0) {
    console.error(
      "[cfkit] push failed; inspect local and remote state before any retry",
    );

    return push.status ?? 1;
  }

  return 0;
}

function runDraftPr(
  root: string,
  args: readonly string[],
  paths: readonly string[],
): number {
  const title = flagValue(args, "--title") ?? "Draft change";
  const bodyPath = join(root, ".cfkit", "handoff-draft-pr-body.md");
  const hasGh =
    spawnSync("gh", ["--version"], { encoding: "utf8" }).status === 0;

  writeFileSync(
    bodyPath,
    `Changed paths:\n\n${paths.map((path) => `- ${path}`).join("\n")}\n`,
  );

  if (!hasGh) {
    console.error(
      `[cfkit] gh is not available; create the draft PR manually with:\n  gh pr create --draft --title "${title}" --body-file ${bodyPath}`,
    );

    return 1;
  }

  const created = spawnSync(
    "gh",
    ["pr", "create", "--draft", "--title", title, "--body-file", bodyPath],
    { cwd: root, stdio: "inherit" },
  );

  if (created.status !== 0) {
    console.error(
      "[cfkit] draft PR creation failed; inspect local and remote state before any retry",
    );

    return created.status ?? 1;
  }

  return 0;
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
function applyAction(
  root: string,
  subcommand: "commit" | "push" | "draft-pr",
  args: readonly string[],
  approvedPaths: readonly string[],
): number {
  try {
    if (subcommand === "commit") return runCommit(root, args, approvedPaths);
    if (subcommand === "push") return runPush(root);

    return runDraftPr(root, args, approvedPaths);
  } catch (error) {
    if (error instanceof UsageError) throw error;

    const message = error instanceof Error ? error.message : String(error);

    console.error(`[cfkit] handoff ${subcommand} refused: ${message}`);

    return 1;
  }
}

function runMutation(
  root: string,
  subcommand: "commit" | "push" | "draft-pr",
  args: readonly string[],
  taskId: string,
  challenge: string,
): number {
  const approval = readApproval(root, taskId, subcommand);
  const verdict = verifyApproval({
    approval,
    action: subcommand,
    challenge,
    nowMs: Date.now(),
    changedPaths: scopedPaths(root, flagValue(args, "--paths")),
    taskFingerprint: taskFingerprint(root),
  });

  if (!verdict.ok) {
    console.error(`[cfkit] handoff refused: ${verdict.reason}`);

    return 1;
  }

  const approvedPaths = approval?.changedPaths ?? [];
  const status = applyAction(root, subcommand, args, approvedPaths);

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
