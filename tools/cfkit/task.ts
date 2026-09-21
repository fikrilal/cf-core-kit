import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type RiskLevel = "low" | "medium" | "high";
export type LaneName = "fast" | "full" | "ci";

export type RiskRule = Readonly<{
  id: string;
  level: RiskLevel;
  prefixes: readonly string[];
  exact: readonly string[];
}>;

const RISK_RULES: readonly RiskRule[] = [
  {
    id: "high.auth",
    level: "high",
    prefixes: [
      "src/platform/auth/",
      "src/platform/storage/",
      "src/platform/rate-limit/",
    ],
    exact: [],
  },
  {
    id: "high.data",
    level: "high",
    prefixes: ["db/migrations/"],
    exact: ["src/platform/db/schema.ts"],
  },
  {
    id: "high.deploy",
    level: "high",
    prefixes: [],
    exact: [
      "wrangler.jsonc",
      "package.json",
      "package-lock.json",
      "worker-configuration.d.ts",
    ],
  },
  {
    id: "high.harness",
    level: "high",
    prefixes: [
      "tools/cfkit/",
      "scripts/budget/",
      "scripts/drift/",
      "scripts/contract/",
      "scripts/lint/",
      "scripts/scaffold/",
    ],
    exact: [],
  },
  {
    id: "high.contract",
    level: "high",
    prefixes: ["contracts/", "tools/parity/", "tools/contract/"],
    exact: ["src/shared/error-codes.ts"],
  },
  { id: "medium.application", level: "medium", prefixes: ["src/"], exact: [] },
  { id: "medium.tests", level: "medium", prefixes: ["test/"], exact: [] },
  { id: "medium.scripts", level: "medium", prefixes: ["scripts/"], exact: [] },
  { id: "low.docs", level: "low", prefixes: ["docs/", "_WIP/"], exact: [] },
  {
    id: "low.root",
    level: "low",
    prefixes: [],
    exact: ["README.md", "AGENTS.md", ".gitignore"],
  },
];

const RISK_ORDER: Readonly<Record<RiskLevel, number>> = {
  low: 0,
  medium: 1,
  high: 2,
};

const RUNTIME_PREFIXES: readonly string[] = [
  "src/platform/auth/",
  "src/platform/db/",
  "src/platform/queue/",
  "src/platform/storage/",
  "src/features/",
  "src/worker.ts",
  "src/jobs.ts",
  "src/app.ts",
  "db/migrations/",
  "tools/contract/",
  "contracts/",
];

export function classifyPath(path: string): Readonly<{
  id: string;
  level: RiskLevel;
}> {
  for (const rule of RISK_RULES) {
    if (rule.exact.includes(path)) return { id: rule.id, level: rule.level };
  }

  for (const rule of RISK_RULES) {
    if (rule.prefixes.some((prefix) => path.startsWith(prefix))) {
      return { id: rule.id, level: rule.level };
    }
  }

  return { id: "medium.unknown", level: "medium" };
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

    if (RISK_ORDER[classified.level] > RISK_ORDER[risk])
      risk = classified.level;
  }

  return { risk, rules: [...rules].sort() };
}

export function laneFor(risk: RiskLevel, paths: readonly string[]): LaneName {
  const runtimeRelevant = paths.some((path) =>
    RUNTIME_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(prefix),
    ),
  );

  if (runtimeRelevant) return "ci";

  return risk === "low" ? "fast" : "full";
}

export function taskIdFromPlan(planPath: string): string {
  const file = planPath.split("/").pop() ?? "";
  const slug = file.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}_/, "");

  if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
    throw new Error(`cannot derive a task id from "${planPath}"`);
  }

  return slug;
}

export function declaredRiskFromPlan(planSource: string): RiskLevel {
  const match = /^- Risk: (low|medium|high)$/m.exec(planSource);

  if (match === null) {
    throw new Error("plan is missing a `- Risk: low|medium|high` header");
  }

  return match[1] as RiskLevel;
}

export type TaskFailure = Readonly<{
  stepId: string;
  repeatCount: number;
}>;

export type TaskStatus = "active" | "verified" | "escalated";

export type TaskState = Readonly<{
  version: 1;
  taskId: string;
  planPath: string;
  declaredRisk: RiskLevel;
  effectiveRisk: RiskLevel;
  rules: readonly string[];
  lane: LaneName;
  repairLimit: number;
  status: TaskStatus;
  attempt: number;
  failures: readonly TaskFailure[];
  updatedAt: string;
}>;

export const DEFAULT_REPAIR_LIMIT = 3;

export function recordFailure(state: TaskState, stepId: string): TaskState {
  const failures: TaskFailure[] = state.failures.map((failure) =>
    failure.stepId === stepId
      ? { stepId, repeatCount: failure.repeatCount + 1 }
      : failure,
  );

  if (!failures.some((failure) => failure.stepId === stepId)) {
    failures.push({ stepId, repeatCount: 1 });
  }

  const exhausted = failures.some(
    (failure) => failure.repeatCount > state.repairLimit,
  );

  return {
    ...state,
    attempt: state.attempt + 1,
    failures,
    status: exhausted ? "escalated" : "active",
    updatedAt: new Date().toISOString(),
  };
}

export function recordSuccess(state: TaskState): TaskState {
  return {
    ...state,
    attempt: state.attempt + 1,
    failures: [],
    status: "verified",
    updatedAt: new Date().toISOString(),
  };
}

export function statePath(taskId: string): string {
  return join(".cfkit", "tasks", taskId, "state.json");
}

export function readTaskState(
  root: string,
  taskId: string,
): TaskState | undefined {
  const path = join(root, statePath(taskId));

  if (!existsSync(path)) return undefined;

  return JSON.parse(readFileSync(path, "utf8")) as TaskState;
}

export function writeTaskState(root: string, state: TaskState): string {
  const relative = statePath(state.taskId);
  const path = join(root, relative);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);

  return relative;
}

export type BeginTaskInput = Readonly<{
  root: string;
  planPath: string;
  planSource: string;
  changedPaths: readonly string[];
  repairLimit?: number;
}>;

export function beginTask(input: BeginTaskInput): TaskState {
  if (!input.planPath.startsWith("docs/exec-plans/active/")) {
    throw new Error(
      `task plans must live under docs/exec-plans/active/ (got "${input.planPath}")`,
    );
  }

  if (!/^- Status: active$/m.test(input.planSource)) {
    throw new Error("plan must be `- Status: active` before a task can begin");
  }

  const taskId = taskIdFromPlan(input.planPath);

  if (readTaskState(input.root, taskId) !== undefined) {
    throw new Error(`task "${taskId}" is already tracked`);
  }

  const declaredRisk = declaredRiskFromPlan(input.planSource);
  const { risk, rules } = effectiveRisk(declaredRisk, input.changedPaths);

  return {
    version: 1,
    taskId,
    planPath: input.planPath,
    declaredRisk,
    effectiveRisk: risk,
    rules,
    lane: laneFor(risk, input.changedPaths),
    repairLimit: input.repairLimit ?? DEFAULT_REPAIR_LIMIT,
    status: "active",
    attempt: 0,
    failures: [],
    updatedAt: new Date().toISOString(),
  };
}
