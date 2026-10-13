import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { flagValue, requireFlagValue } from "./cli-args.ts";
import { currentBranch, git } from "./git.ts";
import { GH_DRAFT_PR_ARGS } from "./handoff.ts";
import { UsageError } from "./usage-error.ts";

/**
 * The three mutations a handoff may perform, and nothing else: exact-path staging then a commit, a non-force
 * push, or a *draft* pull request. Merge, deploy, force-push and ready-for-review are not implemented here —
 * the refusal set is a list in `handoff.ts` that a fixture checks against this file.
 */
export function stageApprovedPaths(
  root: string,
  paths: readonly string[],
): void {
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
    [
      ...GH_DRAFT_PR_ARGS.slice(0, 3),
      title,
      GH_DRAFT_PR_ARGS[4] ?? "--body-file",
      bodyPath,
    ],
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

export function applyAction(
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
