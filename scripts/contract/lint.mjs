import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const DEFAULT_TARGET = "docs/openapi/openapi.yaml";

export function lintSpec(root, target = DEFAULT_TARGET) {
  return spawnSync(
    "npx",
    ["--no-install", "spectral", "lint", "--fail-severity", "warn", target],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function main() {
  const result = lintSpec(process.cwd());
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();

  if (output !== "") console.log(output);

  if ((result.status ?? 1) !== 0) {
    console.error(`[contract] spectral lint failed for ${DEFAULT_TARGET}`);
    process.exit(result.status ?? 1);
  }

  console.log(`[contract] spectral lint passed for ${DEFAULT_TARGET}`);
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main();
}
