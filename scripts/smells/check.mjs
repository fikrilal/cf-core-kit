import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SEVERITIES = ["low", "medium", "high"];
export const SEVERITY_ORDER = { low: 0, medium: 1, high: 2 };
export const DEFAULT_MIN_SEVERITY = "high";
export const REGISTRY_PATH = "src/jobs.ts";
export const BASELINE_PATH = "tools/smells-baseline.json";
export const REPORT_PATH = "_WIP/architecture-smells.md";
export const WALL_CLOCK_ALLOWLIST = [
  "src/platform/clock/clock.ts",
  "src/platform/http/request-logging.ts",
  "src/platform/rate-limit/rate-limiter.ts",
];
export const CONSOLE_ALLOWLIST_PREFIX = "src/platform/logging/";

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function errorCodeNames(root) {
  const source = readFileSync(join(root, "src/shared/error-codes.ts"), "utf8");

  return new Set(
    [...source.matchAll(/^\s+([A-Z][A-Z0-9_]+) = /gm)].map((match) => match[1]),
  );
}

/**
 * Rule set (deliberative): a rule earns its place only when its semantics are precise enough to
 * gate on. A "batch queries must be bounded" heuristic was written and **dropped** — a keyed
 * delete (`where(eq(id, ...))`) is already bounded, and regexes cannot tell keyed from unbounded
 * without producing false positives; that property stays a test/review concern instead.
 */
export const RULES = [
  {
    id: "uncomposed_job_module",
    severity: "high",
    description:
      "A module defining jobs must be composed into the registry, otherwise the job can never run.",
    docsLink: "docs/standards/queues-jobs.md",
    scan(input) {
      if (input.file.endsWith(".spec.ts")) return [];
      if (!input.source.includes("defineJob(")) return [];
      if (input.file === REGISTRY_PATH) return [];

      const registry = readFileSync(join(input.root, REGISTRY_PATH), "utf8");
      const specifier = input.file.replace(/^src\//, "./").replace(/\.ts$/, "");

      if (registry.includes(specifier)) return [];

      return [
        {
          detail: `defines jobs but ${REGISTRY_PATH} does not import ${specifier}`,
          line: lineOf(input.source, input.source.indexOf("defineJob(")),
        },
      ];
    },
  },
  {
    id: "raw_error_code_literal",
    severity: "medium",
    description:
      "Error codes must come from the typed enum, not from string literals outside the enum definition.",
    docsLink: "docs/standards/observability.md",
    scan(input) {
      if (input.file === "src/shared/error-codes.ts") return [];

      const codes = errorCodeNames(input.root);
      const findings = [];

      for (const match of input.source.matchAll(/"([A-Z][A-Z0-9_]{5,})"/g)) {
        if (!codes.has(match[1])) continue;

        findings.push({
          detail: `error code literal "${match[1]}" should reference ErrorCode`,
          line: lineOf(input.source, match.index ?? 0),
        });
      }

      return findings;
    },
  },
  {
    id: "wall_clock_in_feature",
    severity: "medium",
    description:
      "Features read time from the injected Clock, never from the wall clock directly.",
    docsLink: "docs/core/project-architecture.md",
    scan(input) {
      if (!input.file.startsWith("src/features/")) return [];
      if (input.file.endsWith(".spec.ts")) return [];
      if (WALL_CLOCK_ALLOWLIST.includes(input.file)) return [];

      const findings = [];

      for (const match of input.source.matchAll(
        /\b(new Date\(\)|Date\.now\(\))/g,
      )) {
        findings.push({
          detail: `${match[1]} in feature code; take the Clock from the composition root`,
          line: lineOf(input.source, match.index ?? 0),
        });
      }

      return findings;
    },
  },
  {
    id: "console_usage_outside_logger",
    severity: "medium",
    description:
      "src/** logs through the structured logger; console output is allowed only inside the logging module.",
    docsLink: "docs/standards/observability.md",
    scan(input) {
      if (input.file.startsWith(CONSOLE_ALLOWLIST_PREFIX)) return [];
      if (input.file.endsWith(".spec.ts")) return [];

      const findings = [];

      for (const match of input.source.matchAll(
        /\bconsole\.(log|debug|info|warn|error)\(/g,
      )) {
        findings.push({
          detail: `console.${match[1]} outside ${CONSOLE_ALLOWLIST_PREFIX}`,
          line: lineOf(input.source, match.index ?? 0),
        });
      }

      return findings;
    },
  },
  {
    id: "untracked_todo",
    severity: "low",
    description:
      "Debt markers are tracked; a TODO, FIXME, XXX or HACK comment in src means work that belongs in an exec plan.",
    docsLink: "docs/exec-plans/README.md",
    scan(input) {
      const findings = [];

      for (const match of input.source.matchAll(/\b(TODO|FIXME|XXX|HACK)\b/g)) {
        findings.push({
          detail: `${match[1]} marker in source`,
          line: lineOf(input.source, match.index ?? 0),
        });
      }

      return findings;
    },
  },
];

/** Walks the working tree (not the index): a brand-new file must be scanned before it is staged. */
export function listSourceFiles(root) {
  const files = [];

  const walk = (relative) => {
    for (const entry of readdirSync(join(root, relative), {
      withFileTypes: true,
    })) {
      const path = `${relative}/${entry.name}`;

      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!path.endsWith(".ts") || path.endsWith(".spec.ts")) continue;

      files.push(path);
    }
  };

  walk("src");

  return files.sort();
}

export function scanRepository(input) {
  const files = input.files ?? listSourceFiles(input.root);
  const findings = [];

  for (const file of files) {
    if (input.rules !== undefined) {
      for (const rule of input.rules) {
        for (const finding of rule.scan({
          root: input.root,
          file,
          source: input.sourceFor(file),
        })) {
          findings.push({
            file,
            ruleId: rule.id,
            severity: rule.severity,
            ...finding,
          });
        }
      }
      continue;
    }

    const source = input.sourceFor(file);

    for (const rule of RULES) {
      for (const finding of rule.scan({ root: input.root, file, source })) {
        findings.push({
          file,
          ruleId: rule.id,
          severity: rule.severity,
          ...finding,
        });
      }
    }
  }

  return findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.ruleId.localeCompare(right.ruleId),
  );
}

export function findingKey(finding) {
  return `${finding.ruleId}:${finding.file}`;
}

export function loadBaseline(root) {
  const baseline = JSON.parse(readFileSync(join(root, BASELINE_PATH), "utf8"));

  if (baseline?.schemaVersion !== 1 || !Array.isArray(baseline?.keys)) {
    throw new Error(
      `${BASELINE_PATH} must be { schemaVersion: 1, keys: [...] }`,
    );
  }

  return baseline;
}

export function missingFromBaseline(findings, baseline) {
  const keys = new Set(baseline.keys.map((entry) => entry.key));

  return findings.filter((finding) => !keys.has(findingKey(finding)));
}

export function findingsAtOrAbove(findings, minSeverity) {
  const floor = SEVERITY_ORDER[minSeverity];

  return findings.filter(
    (finding) => SEVERITY_ORDER[finding.severity] >= floor,
  );
}

export function renderReport(findings) {
  const lines = [
    "# Architecture smells (generated; do not edit by hand)",
    "",
    `Findings: ${String(findings.length)}`,
    "",
  ];

  if (findings.length === 0) {
    lines.push("The tree is clean against every registered rule.", "");

    return lines.join("\n");
  }

  lines.push(
    "| Rule | Severity | File | Line | Detail |",
    "| --- | --- | --- | --- | --- |",
  );

  for (const finding of findings) {
    lines.push(
      `| ${finding.ruleId} | ${finding.severity} | ${finding.file} | ${String(finding.line)} | ${finding.detail} |`,
    );
  }

  lines.push("");

  return lines.join("\n");
}

function readArgs(argv) {
  const flags = new Set(argv.filter((entry) => entry.startsWith("--")));
  const minSeverityIndex = argv.indexOf("--min-severity");
  const minSeverity =
    minSeverityIndex === -1 ? DEFAULT_MIN_SEVERITY : argv[minSeverityIndex + 1];

  return {
    reportOnly: flags.has("--report-only"),
    writeBaseline: flags.has("--write-baseline"),
    minSeverity: SEVERITIES.includes(minSeverity) ? minSeverity : undefined,
  };
}

function writeReport(root, findings) {
  const path = join(root, REPORT_PATH);

  writeFileSync(path, renderReport(findings));
  console.log(`[smells] report written to ${REPORT_PATH}`);
}

function writeBaseline(root, findings) {
  if (process.env.SMELLS_BASELINE_APPROVED !== "true") {
    console.error(
      "[smells] refusing to write the baseline without SMELLS_BASELINE_APPROVED=true",
    );

    return 1;
  }

  const keys = findings.map((finding) => ({
    key: findingKey(finding),
    ruleId: finding.ruleId,
    file: finding.file,
    reviewedOn: new Date().toISOString().slice(0, 10),
  }));

  writeFileSync(
    join(root, BASELINE_PATH),
    `${JSON.stringify({ schemaVersion: 1, keys }, null, 2)}\n`,
  );
  console.log(`[smells] baseline written with ${String(keys.length)} keys`);

  return 0;
}

function main() {
  const root = process.cwd();
  const args = readArgs(process.argv.slice(2));

  if (args.minSeverity === undefined) {
    console.error("[smells] --min-severity must be low|medium|high");

    return 1;
  }

  const findings = scanRepository({
    root,
    sourceFor: (file) => readFileSync(join(root, file), "utf8"),
  });

  writeReport(root, findings);

  if (args.writeBaseline) return writeBaseline(root, findings);

  const baseline = loadBaseline(root);
  const unbaselined = missingFromBaseline(findings, baseline);
  const failing = findingsAtOrAbove(unbaselined, args.minSeverity);

  console.log(
    `[smells] findings ${String(findings.length)}; unbaselined ${String(unbaselined.length)}; at or above ${args.minSeverity} ${String(failing.length)}`,
  );

  if (failing.length === 0) {
    console.log("[smells] all checks passed");

    return 0;
  }

  if (args.reportOnly) {
    console.log("[smells] report-only mode; not failing");

    return 0;
  }

  console.error("[smells] new findings:");

  for (const finding of failing) {
    console.error(
      `  x ${finding.ruleId} (${finding.severity}) ${finding.file}:${String(finding.line)}: ${finding.detail}`,
    );
  }

  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
