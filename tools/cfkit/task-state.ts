import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { PlanFile } from "./plans.ts";
import type { LaneName, RiskLevel } from "./risk-classifier.ts";

/**
 * The task state: the eleven phases, everything the plan authorised, the repository it was begun in, and the
 * repair ledger. The *machine* (which transition is legal, when a failure escalates) lives in `task.ts`; this
 * module owns the shape, the derivation from a plan, and persistence, so both stay readable.
 */
export const TASK_STATE_VERSION = 2;
export const TASK_PHASES = [
  "queued",
  "authorized",
  "preparing",
  "running",
  "verifying",
  "repairing",
  "ready_for_review",
  "escalated",
  "cancelled",
  "failed",
  "handed_off",
] as const;
export const TERMINAL_PHASES = [
  "escalated",
  "cancelled",
  "failed",
  "handed_off",
] as const;
export const DEFAULT_REPAIR_LIMIT = 3;
export const DEFAULT_TASK_TIMEOUT_SECONDS = 90 * 60;
export const STOP_REASONS = [
  "task.timeout",
  "task.repair-limit",
  "task.preflight",
] as const;

export type TaskPhase = (typeof TASK_PHASES)[number];
export type StopReason = (typeof STOP_REASONS)[number];

export type TaskFailure = Readonly<{
  stepId: string;
  fingerprint: string;
  code: string;
  repeatCount: number;
}>;

export type TaskTransition = Readonly<{
  at: string;
  from: TaskPhase;
  to: TaskPhase;
  reason?: string;
}>;

export type TaskState = Readonly<{
  version: number;
  taskId: string;
  planPath: string;
  declaredRisk: RiskLevel;
  effectiveRisk: RiskLevel;
  maximumRisk: RiskLevel;
  rules: readonly string[];
  lane: LaneName;
  authority: readonly string[];
  authorityHash: string;
  allowedPaths: readonly string[];
  allowedActions: readonly string[];
  repairLimit: number;
  taskTimeoutSeconds: number;
  repositoryIdentity: string;
  baseRevision: string;
  preexistingPaths: readonly string[];
  phase: TaskPhase;
  stopReason?: StopReason;
  attempt: number;
  failures: readonly TaskFailure[];
  history: readonly TaskTransition[];
  updatedAt: string;
}>;

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

export function riskFromPlan(
  plan: PlanFile,
  key: string,
  fallback: RiskLevel,
): RiskLevel {
  const value = plan.headers[key];

  return value === "low" || value === "medium" || value === "high"
    ? value
    : fallback;
}

export function listFromPlan(plan: PlanFile, key: string): readonly string[] {
  return (plan.headers[key] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export function parseTimeoutSeconds(value: string | undefined): number {
  const match = /^(\d+)([smh])$/.exec(value ?? "");

  if (match === null) return DEFAULT_TASK_TIMEOUT_SECONDS;

  const amount = Number(match[1]);
  const unit = match[2];

  if (unit === "h") return amount * 3_600;
  if (unit === "m") return amount * 60;

  return amount;
}

export function authorityHash(authority: readonly string[]): string {
  return createHash("sha256").update(authority.join(",")).digest("hex");
}

/** Failures are counted by fingerprint, so two different failures on one step are two entries. */
export function failureFingerprint(
  input: Readonly<{ stepId: string; code: string }>,
): string {
  return createHash("sha256")
    .update(`${input.stepId}:${input.code}`)
    .digest("hex");
}

export function statePath(taskId: string): string {
  return join(".cfkit", "tasks", taskId, "state.json");
}

/** Schema 1 states are upgraded in memory: the phase comes from the old status, and the history says so. */
export function migrateState(raw: unknown, now: Date): unknown {
  const record = raw as Record<string, unknown>;

  if (record.version === TASK_STATE_VERSION) return record;
  if (record.version !== 1) return record;

  const status = record.status;
  const phase: TaskPhase =
    status === "verified"
      ? "ready_for_review"
      : status === "escalated"
        ? "escalated"
        : "authorized";

  return {
    ...record,
    version: TASK_STATE_VERSION,
    phase,
    maximumRisk:
      record.declaredRisk === "low" || record.declaredRisk === "medium"
        ? record.declaredRisk
        : "high",
    authority: [],
    authorityHash: "",
    allowedPaths: [],
    allowedActions: [],
    taskTimeoutSeconds: DEFAULT_TASK_TIMEOUT_SECONDS,
    repositoryIdentity: "",
    baseRevision: "",
    preexistingPaths: [],
    history: [
      {
        at: now.toISOString(),
        from: "queued",
        to: phase,
        reason: "migrated from schema 1",
      },
    ],
    updatedAt: now.toISOString(),
  };
}

export function readTaskState(
  root: string,
  taskId: string,
  now: Date = new Date(),
): TaskState | undefined {
  const path = join(root, statePath(taskId));

  if (!existsSync(path)) return undefined;

  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));

  return migrateState(raw, now) as TaskState;
}

export function writeTaskState(root: string, state: TaskState): string {
  const relative = statePath(state.taskId);
  const path = join(root, relative);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });

  return relative;
}

export function isTerminal(phase: TaskPhase): boolean {
  return TERMINAL_PHASES.includes(phase as (typeof TERMINAL_PHASES)[number]);
}
