import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MIN_TOKENS = 60;
export const MIN_LINES = 7;
export const SMALL_HELPER_MIN_TOKENS = 24;
export const SMALL_HELPER_MIN_LINES = 4;
export const CORE_ALLOWLIST_PATH = "tools/duplication-allowlist.json";
export const SMALL_HELPER_ALLOWLIST_PATH =
  "tools/small-helper-duplication-allowlist.json";
export const REPORT_PATH = "_WIP/duplication-report.md";

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

export const PROFILES = [
  {
    id: "core",
    label: "Core",
    minTokens: MIN_TOKENS,
    minLines: MIN_LINES,
    pattern: "**/*.{ts,mjs,js}",
    allowlistPath: CORE_ALLOWLIST_PATH,
    fatalByDefault: true,
  },
  {
    id: "small-helpers",
    label: "Small helpers",
    minTokens: SMALL_HELPER_MIN_TOKENS,
    minLines: SMALL_HELPER_MIN_LINES,
    // Product code only: scripts and tools are entrypoint boilerplate, which is why the
    // family scopes its small-helper profile to libraries and worker jobs.
    pattern: "src/**/*.ts",
    allowlistPath: SMALL_HELPER_ALLOWLIST_PATH,
    fatalByDefault: false,
  },
];

/**
 * Clones are categorised so a report leads with the pattern that repeats, not with a file list.
 * An uncategorised clone stays visible in its own section instead of being filtered away.
 */
export const CATEGORIES = [
  {
    id: "error-mapping",
    description: "typed errors and problem mapping",
    pattern: /errors|error-codes/,
  },
  {
    id: "query-builders",
    description: "repository queries, cursors and filters",
    pattern: /repository|list-query|cursor/,
  },
  {
    id: "rate-limiting",
    description: "rate-limit policies and limiter glue",
    pattern: /rate-limit/,
  },
  {
    id: "queue-and-jobs",
    description: "queue envelopes, producers and job handlers",
    pattern: /queue|jobs/,
  },
  {
    id: "request-pipeline",
    description: "http middleware, envelopes and request ids",
    pattern: /platform\/http|request-id|request-logging/,
  },
  {
    id: "clock-and-duration",
    description: "clock and duration policy",
    pattern: /clock|duration-policy/,
  },
  {
    id: "route-wiring",
    description: "route definitions and registrations",
    pattern: /\.routes\.ts$/,
  },
  {
    id: "test-support",
    description: "shared test fixtures and harness helpers",
    pattern: /^test\/|fixtures/,
  },
];

export function resolveProfile(id) {
  return PROFILES.find((profile) => profile.id === id);
}

export function cloneFiles(clone) {
  return [clone?.firstFile?.name ?? "", clone?.secondFile?.name ?? ""];
}

export function categorizeClone(clone) {
  const files = cloneFiles(clone).join(" ");
  const category = CATEGORIES.find((entry) => entry.pattern.test(files));

  return category?.id;
}

export function cloneViolation(clone) {
  return `${clone.firstFile.name} <-> ${clone.secondFile.name} (${String(clone.lines)} lines, ${String(clone.tokens)} tokens)`;
}

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
    .map((clone) => cloneViolation(clone));
}

export function runDuplication(root, options = {}) {
  const profile = resolveProfile(options.profile ?? "core");

  if (profile === undefined) {
    throw new Error(
      `unknown duplication profile "${String(options.profile)}" (expected ${PROFILES.map((entry) => entry.id).join("|")})`,
    );
  }

  const outputDirectory = mkdtempSync(
    join(tmpdir(), `cfkit-duplication-${profile.id}-`),
  );

  try {
    execFileSync(
      "npx",
      [
        "--no-install",
        "jscpd",
        "--min-tokens",
        String(profile.minTokens),
        "--min-lines",
        String(profile.minLines),
        "--reporters",
        "json",
        "--output",
        outputDirectory,
        "--pattern",
        profile.pattern,
        "--ignore",
        DUPLICATION_IGNORES.join(","),
      ],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" },
    );

    const report = JSON.parse(
      readFileSync(join(outputDirectory, "jscpd-report.json"), "utf8"),
    );
    const allowlist =
      options.allowlist ??
      JSON.parse(readFileSync(join(root, profile.allowlistPath), "utf8"));
    const duplicates = report.duplicates ?? [];
    const groups = allowlist.reviewedAcceptable ?? [];
    const violations = findViolations(duplicates, groups);
    const violationSet = new Set(violations);
    const actionableClones = duplicates.filter((clone) =>
      violationSet.has(cloneViolation(clone)),
    );

    return {
      profile: profile.id,
      label: profile.label,
      minTokens: profile.minTokens,
      minLines: profile.minLines,
      statistics: report.statistics ?? {},
      clones: duplicates.length,
      allowlisted: duplicates.length - violations.length,
      violations,
      actionableClones,
      duplicates,
      groups,
    };
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

export function runDuplicationCheck(root) {
  const result = runDuplication(root, { profile: "core" });

  return {
    statistics: result.statistics,
    clones: result.clones,
    allowlisted: result.allowlisted,
    violations: result.violations,
  };
}

function renderProfileSection(result) {
  const percentage = result.statistics.total?.percentage ?? 0;
  const lines = [
    `## ${result.label} (min ${String(result.minTokens)} tokens / ${String(result.minLines)} lines)`,
    "",
    `Clones: ${String(result.clones)} (${String(percentage)}% of lines) — allowlisted ${String(result.allowlisted)}, actionable ${String(result.violations.length)}`,
    "",
  ];
  const actionable = result.actionableClones;
  const byCategory = new Map();

  for (const clone of actionable) {
    const category = categorizeClone(clone) ?? "uncategorized";

    byCategory.set(category, [...(byCategory.get(category) ?? []), clone]);
  }

  if (byCategory.size === 0) {
    lines.push("No actionable clones.", "");
  }

  for (const [category, clones] of [...byCategory.entries()].sort()) {
    const description =
      CATEGORIES.find((entry) => entry.id === category)?.description ??
      "not yet categorised (visibility only)";

    lines.push(`### ${category} — ${description}`, "");

    for (const clone of clones) {
      lines.push(
        `- ${cloneFiles(clone)[0]} <-> ${cloneFiles(clone)[1]} (${String(clone.lines)} lines, ${String(clone.tokens)} tokens)`,
      );
    }

    lines.push("");
  }

  if (result.groups.length > 0) {
    lines.push("### allowlisted (reviewed)", "");

    for (const group of result.groups) {
      lines.push(
        `- ${group.files.join(" <-> ")} — ${group.reason ?? "no reason recorded"}`,
      );
    }

    lines.push("");
  }

  return lines;
}

export function renderDuplicationReport(results) {
  const lines = [
    "# Duplication report (generated; do not edit by hand)",
    "",
    `Profiles: ${results.map((result) => `${result.profile} (${String(result.clones)} clones, ${String(result.violations.length)} actionable)`).join(" | ")}`,
    "",
  ];

  for (const result of results) lines.push(...renderProfileSection(result));

  return lines.join("\n");
}

export function writeDuplicationReport(root, results) {
  writeFileSync(join(root, REPORT_PATH), renderDuplicationReport(results));
  console.log(`[duplication] report written to ${REPORT_PATH}`);
}

function reportLine(result) {
  const percentage = result.statistics.total?.percentage ?? 0;

  return `[duplication] ${result.profile}: clones ${String(result.clones)} (${String(percentage)}% of lines); allowlisted ${String(result.allowlisted)}; actionable ${String(result.violations.length)}`;
}

function main() {
  const root = process.cwd();
  const argv = process.argv.slice(2);
  const profileIndex = argv.indexOf("--profile");
  const profileId = profileIndex === -1 ? "core" : argv[profileIndex + 1];
  const fatalFound = argv.includes("--fatal-found");
  const report = argv.includes("--report");
  const profile = resolveProfile(profileId ?? "");

  if (profile === undefined) {
    console.error(
      `[duplication] unknown profile "${String(profileId)}" (expected ${PROFILES.map((entry) => entry.id).join("|")})`,
    );

    process.exitCode = 1;

    return;
  }

  if (report) {
    const results = PROFILES.map((entry) =>
      runDuplication(root, { profile: entry.id }),
    );

    for (const result of results) console.log(reportLine(result));

    writeDuplicationReport(root, results);

    return;
  }

  const result = runDuplication(root, { profile: profile.id });

  console.log(reportLine(result));

  if (result.violations.length === 0) {
    console.log("[duplication] no unallowlisted clones");

    return;
  }

  console.error(`[duplication] actionable clones (${profile.id}):`);

  for (const violation of result.violations) console.error(`  x ${violation}`);

  if (profile.fatalByDefault || fatalFound) {
    process.exitCode = 1;

    return;
  }

  console.log(
    "[duplication] report-only profile; not failing (pass --fatal-found to enforce)",
  );
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) main();
