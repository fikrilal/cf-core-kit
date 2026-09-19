import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MIN_TOKENS = 60;

export const DUPLICATION_IGNORES = [
  "**/node_modules/**",
  "**/*.spec.ts",
  "**/*.test.ts",
  "**/*.test.mjs",
  "dist/**",
  "coverage/**",
  ".wrangler/**",
  "worker-configuration.d.ts",
  "db/migrations/**",
  "contracts/**",
];

export function findViolations(duplicates, groups) {
  return duplicates
    .filter(
      (clone) =>
        !groups.some(
          (group) =>
            group.files.includes(clone.firstFile.name) &&
            group.files.includes(clone.secondFile.name),
        ),
    )
    .map(
      (clone) =>
        `${clone.firstFile.name} <-> ${clone.secondFile.name} (${String(clone.lines)} lines, ${String(clone.tokens)} tokens)`,
    );
}

export function runDuplicationCheck(root) {
  const outputDirectory = mkdtempSync(join(tmpdir(), "cfkit-duplication-"));

  try {
    execFileSync(
      "npx",
      [
        "--no-install",
        "jscpd",
        "--min-tokens",
        String(MIN_TOKENS),
        "--reporters",
        "json",
        "--output",
        outputDirectory,
        "--pattern",
        "**/*.{ts,mjs,js}",
        "--ignore",
        DUPLICATION_IGNORES.join(","),
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    );

    const report = JSON.parse(
      readFileSync(join(outputDirectory, "jscpd-report.json"), "utf8"),
    );
    const allowlist = JSON.parse(
      readFileSync(join(root, "tools/duplication-allowlist.json"), "utf8"),
    );
    const duplicates = report.duplicates ?? [];
    const groups = allowlist.reviewedAcceptable ?? [];

    return {
      statistics: report.statistics ?? {},
      clones: duplicates.length,
      allowlisted:
        duplicates.length - findViolations(duplicates, groups).length,
      violations: findViolations(duplicates, groups),
    };
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

function main() {
  const result = runDuplicationCheck(process.cwd());
  const total = result.statistics.total;
  const percentage = total?.percentage ?? 0;

  console.log(
    `[duplication] clones: ${String(result.clones)} (${String(percentage)}% of lines); allowlisted: ${String(result.allowlisted)}`,
  );

  if (result.violations.length === 0) {
    console.log("[duplication] no unallowlisted clones");

    return;
  }

  console.error("[duplication] unallowlisted clones:");
  for (const violation of result.violations) console.error(`  x ${violation}`);

  process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) main();
