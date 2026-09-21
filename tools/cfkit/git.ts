import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

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

export function taskFingerprint(root: string): string {
  const hash = createHash("sha256");

  hash.update(currentRevision(root));
  hash.update("\n");
  hash.update(changedPaths(root).join("\n"));

  return hash.digest("hex");
}
