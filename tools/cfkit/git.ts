import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";

export function git(args: readonly string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }

  return result.stdout;
}

export function changedPaths(root: string): readonly string[] {
  const parseLine = (line: string): string => {
    const entry = line.slice(3);
    const renamed = entry.split(" -> ");
    const raw = renamed[renamed.length - 1] ?? entry;

    return raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  };

  return git(["status", "--porcelain", "-uall"], root)
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line !== "")
    .map(parseLine)
    .filter((path) => !path.startsWith(".cfkit/"))
    .sort();
}

export function currentRevision(root: string): string {
  return git(["rev-parse", "HEAD"], root).trim();
}

export function currentBranch(root: string): string {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], root).trim();
}

/**
 * Identity of the repository a task was begun in: the real path of the working tree plus the common git
 * directory. A task state cannot be carried into another clone, and two worktrees of one repository share it
 * on purpose, because they share the object store and the refs.
 */
export function repositoryIdentity(root: string): string {
  const commonDirectory = git(["rev-parse", "--git-common-dir"], root).trim();

  return createHash("sha256")
    .update(`${realpathSync(root)}\n${commonDirectory}`)
    .digest("hex");
}

export function taskFingerprint(root: string): string {
  const hash = createHash("sha256");

  hash.update(currentRevision(root));
  hash.update("\n");
  hash.update(changedPaths(root).join("\n"));

  return hash.digest("hex");
}
