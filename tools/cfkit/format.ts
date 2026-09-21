import { spawnSync } from "node:child_process";

export function formatPaths(paths: readonly string[]): void {
  spawnSync("npx", ["--no-install", "prettier", "--write", ...paths], {
    stdio: "ignore",
  });
}
