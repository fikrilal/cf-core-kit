import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  effectiveRisk,
  selectLanes,
  type LaneName,
  type RiskLevel,
} from "./risk-classifier.ts";

export type { LaneName, RiskLevel };

export function readDeclaredRisk(planSource: string): RiskLevel | undefined {
  const match = /^- Risk: (low|medium|high)$/m.exec(planSource);

  return match === null ? undefined : (match[1] as RiskLevel);
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
  const risk = readDeclaredRisk(planSource);

  if (risk === undefined) {
    throw new Error("plan is missing a `- Risk: low|medium|high` header");
  }

  return risk;
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
  const lanes = selectLanes(risk, input.changedPaths);

  return {
    version: 1,
    taskId,
    planPath: input.planPath,
    declaredRisk,
    effectiveRisk: risk,
    rules,
    lane: lanes.lane,
    repairLimit: input.repairLimit ?? DEFAULT_REPAIR_LIMIT,
    status: "active",
    attempt: 0,
    failures: [],
    updatedAt: new Date().toISOString(),
  };
}
