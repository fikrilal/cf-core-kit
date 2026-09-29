export type RiskLevel = "low" | "medium" | "high";
export type LaneName = "fast" | "full" | "ci";

export type RiskRule = Readonly<{
  id: string;
  level: RiskLevel;
  prefixes: readonly string[];
  exact: readonly string[];
  suffixes: readonly string[];
  examples: readonly string[];
  planned?: boolean;
  note?: string;
}>;

function rule(input: {
  id: string;
  level: RiskLevel;
  prefixes?: readonly string[];
  exact?: readonly string[];
  suffixes?: readonly string[];
  examples?: readonly string[];
  planned?: boolean;
  note?: string;
}): RiskRule {
  return {
    id: input.id,
    level: input.level,
    prefixes: input.prefixes ?? [],
    exact: input.exact ?? [],
    suffixes: input.suffixes ?? [],
    examples: input.examples ?? [],
    ...(input.planned === undefined ? {} : { planned: input.planned }),
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

/**
 * First match per path wins; order is the policy. High rules precede medium and low, and
 * every rule carries example paths that the fixture proves exist in the tree (or is marked
 * `planned`, which is reserved for paths that cannot exist in a clean checkout).
 */
export const RISK_RULES: readonly RiskRule[] = [
  rule({
    id: "high.ci",
    level: "high",
    prefixes: [".github/"],
    examples: [".github/workflows/ci.yml"],
  }),
  rule({
    id: "high.auth",
    level: "high",
    prefixes: [
      "src/platform/auth/",
      "src/platform/storage/",
      "src/platform/rate-limit/",
    ],
    examples: ["src/platform/auth/guard.ts"],
  }),
  rule({
    id: "high.data",
    level: "high",
    prefixes: ["db/migrations/"],
    exact: ["src/platform/db/schema.ts"],
    examples: [
      "db/migrations/0002_swift_thor_girl.sql",
      "src/platform/db/schema.ts",
    ],
  }),
  rule({
    id: "high.deploy",
    level: "high",
    exact: [
      "wrangler.jsonc",
      "package.json",
      "package-lock.json",
      "worker-configuration.d.ts",
      ".nvmrc",
    ],
    examples: ["package.json", "wrangler.jsonc"],
  }),
  rule({
    id: "high.harness",
    level: "high",
    prefixes: [
      "tools/cfkit/",
      "scripts/budget/",
      "scripts/ci/",
      "scripts/contract/",
      "scripts/drift/",
      "scripts/duplication/",
      "scripts/lint/",
      "scripts/parity/",
      "scripts/scaffold/",
      "scripts/security/",
    ],
    examples: ["tools/cfkit/cli.ts", "scripts/budget/check.mjs"],
  }),
  rule({
    id: "high.contract",
    level: "high",
    prefixes: ["contracts/", "tools/parity/", "tools/contract/"],
    exact: ["src/shared/error-codes.ts"],
    examples: ["contracts/backend.openapi.yaml", "tools/parity/coverage.json"],
  }),
  rule({
    id: "high.queue",
    level: "high",
    prefixes: ["src/platform/queue/"],
    exact: ["src/jobs.ts"],
    suffixes: [".jobs.ts", ".jobs.spec.ts"],
    examples: ["src/platform/queue/consumer.ts", "src/jobs.ts"],
  }),
  rule({
    id: "high.deletion",
    level: "high",
    prefixes: ["src/features/users/account-deletion/"],
    examples: [
      "src/features/users/account-deletion/account-deletion.repository.ts",
    ],
  }),
  rule({
    id: "high.secrets",
    level: "high",
    exact: [".dev.vars", ".env"],
    prefixes: [".dev.vars.", ".env."],
    examples: [".dev.vars", ".env"],
    planned: true,
    note: "local secret files never exist in a clean checkout; the rule is exercised by the classifier fixtures",
  }),
  rule({
    id: "medium.application",
    level: "medium",
    prefixes: ["src/"],
    examples: ["src/app.ts"],
  }),
  rule({
    id: "medium.tests",
    level: "medium",
    prefixes: ["test/"],
    examples: ["test/auth-fixtures.ts"],
  }),
  rule({
    id: "medium.scripts",
    level: "medium",
    prefixes: ["scripts/"],
    examples: ["scripts/auth/generate-keys.mjs"],
  }),
  rule({
    id: "medium.config",
    level: "medium",
    exact: [
      "tsconfig.json",
      "drizzle.config.ts",
      "eslint.config.mjs",
      "vitest.config.ts",
      ".spectral.yaml",
      ".prettierrc",
      ".prettierignore",
      ".gitattributes",
    ],
    examples: ["tsconfig.json", "eslint.config.mjs"],
  }),
  rule({
    id: "medium.policy",
    level: "medium",
    exact: ["AGENTS.md"],
    examples: ["AGENTS.md"],
  }),
  rule({
    id: "low.docs",
    level: "low",
    prefixes: ["docs/", "_WIP/"],
    examples: ["docs/README.md"],
  }),
  rule({
    id: "low.root",
    level: "low",
    exact: ["README.md", ".gitignore"],
    examples: ["README.md"],
  }),
];

export const RISK_ORDER: Readonly<Record<RiskLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
};

export const UNKNOWN_RULE_ID = "medium.unknown";

function matches(rule_: RiskRule, path: string): boolean {
  if (rule_.exact.includes(path)) return true;
  if (rule_.prefixes.some((prefix) => path.startsWith(prefix))) return true;

  return rule_.suffixes.some((suffix) => path.endsWith(suffix));
}

export function classifyPath(path: string): Readonly<{
  id: string;
  level: RiskLevel;
}> {
  for (const candidate of RISK_RULES) {
    if (matches(candidate, path)) {
      return { id: candidate.id, level: candidate.level };
    }
  }

  return { id: UNKNOWN_RULE_ID, level: "medium" };
}

export function effectiveRisk(
  declared: RiskLevel,
  paths: readonly string[],
): Readonly<{ risk: RiskLevel; rules: readonly string[] }> {
  let risk = declared;
  const rules = new Set<string>();

  for (const path of paths) {
    const classified = classifyPath(path);

    rules.add(classified.id);

    if (RISK_ORDER[classified.level] > RISK_ORDER[risk]) {
      risk = classified.level;
    }
  }

  return { risk, rules: [...rules].sort() };
}

export type RuntimeReason = Readonly<{
  id: string;
  prefixes: readonly string[];
  exact: readonly string[];
  suffixes: readonly string[];
}>;

export const RUNTIME_REASONS: readonly RuntimeReason[] = [
  {
    id: "path.database-schema",
    prefixes: ["db/migrations/", "src/platform/db/"],
    exact: [],
    suffixes: [],
  },
  {
    id: "path.runtime-platform",
    prefixes: [
      "src/platform/auth/",
      "src/platform/config/",
      "src/platform/queue/",
      "src/platform/rate-limit/",
      "src/platform/storage/",
    ],
    exact: [],
    suffixes: [],
  },
  {
    id: "path.worker",
    prefixes: [],
    exact: ["src/app.ts", "src/jobs.ts", "src/worker.ts"],
    suffixes: [".jobs.ts"],
  },
  {
    id: "path.critical-http",
    prefixes: ["src/features/", "src/platform/http/", "test/integration/"],
    exact: [],
    suffixes: [".routes.ts"],
  },
  {
    id: "path.external-adapter",
    prefixes: ["src/platform/email/", "src/platform/push/"],
    exact: ["wrangler.jsonc"],
    suffixes: [],
  },
];

export function runtimeReasons(paths: readonly string[]): readonly string[] {
  const reasons = new Set<string>();

  for (const path of paths) {
    for (const reason of RUNTIME_REASONS) {
      const matched =
        reason.exact.includes(path) ||
        reason.prefixes.some((prefix) => path.startsWith(prefix)) ||
        reason.suffixes.some((suffix) => path.endsWith(suffix));

      if (matched) reasons.add(reason.id);
    }
  }

  return [...reasons].sort();
}

export type LaneSelection = Readonly<{
  lane: LaneName;
  runtimeRequired: boolean;
  reasons: readonly string[];
}>;

export function selectLanes(
  risk: RiskLevel,
  paths: readonly string[],
): LaneSelection {
  const reasons = runtimeReasons(paths);
  const runtimeRequired = reasons.length > 0;

  return {
    lane: runtimeRequired ? "ci" : risk === "low" ? "fast" : "full",
    runtimeRequired,
    reasons,
  };
}
