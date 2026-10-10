import { parsePlan } from "./plans.ts";
import { effectiveRisk, selectLanes } from "./risk-classifier.ts";
import {
  authorityHash,
  DEFAULT_REPAIR_LIMIT,
  declaredRiskFromPlan,
  failureFingerprint,
  listFromPlan,
  parseTimeoutSeconds,
  readTaskState,
  riskFromPlan,
  taskIdFromPlan,
  TASK_STATE_VERSION,
  type StopReason,
  type TaskPhase,
  type TaskState,
} from "./task-state.ts";

export type {
  StopReason,
  TaskFailure,
  TaskPhase,
  TaskState,
  TaskTransition,
} from "./task-state.ts";
export type { LaneName, RiskLevel } from "./risk-classifier.ts";

/** Legal transitions; the table is the policy, and a phase absent from the keys is terminal. */
export const TRANSITIONS: Readonly<Record<TaskPhase, readonly TaskPhase[]>> = {
  queued: ["authorized", "cancelled"],
  authorized: ["preparing", "cancelled"],
  preparing: ["running", "failed", "cancelled"],
  running: ["verifying", "failed", "cancelled"],
  verifying: [
    "repairing",
    "ready_for_review",
    "escalated",
    "failed",
    "cancelled",
  ],
  repairing: ["running", "escalated", "failed", "cancelled"],
  ready_for_review: ["handed_off", "running", "cancelled"],
  escalated: ["authorized", "cancelled"],
  cancelled: [],
  failed: [],
  handed_off: [],
};

export function canTransition(from: TaskPhase, to: TaskPhase): boolean {
  return TRANSITIONS[from].includes(to);
}

export type TransitionInput = Readonly<{
  now?: Date;
  reason?: string;
  stopReason?: StopReason;
}>;

export function transition(
  state: TaskState,
  to: TaskPhase,
  input: TransitionInput = {},
): TaskState {
  if (!canTransition(state.phase, to)) {
    throw new Error(
      `illegal task transition ${state.phase} -> ${to} (allowed: ${TRANSITIONS[state.phase].join(", ") || "none"})`,
    );
  }

  const at = (input.now ?? new Date()).toISOString();

  return {
    ...state,
    phase: to,
    history: [
      ...state.history,
      {
        at,
        from: state.phase,
        to,
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      },
    ],
    ...(input.stopReason === undefined ? {} : { stopReason: input.stopReason }),
    updatedAt: at,
  };
}

export function recordFailure(
  state: TaskState,
  failure: Readonly<{ stepId: string; code: string }>,
  now: Date = new Date(),
): TaskState {
  const fingerprint = failureFingerprint(failure);
  const existing = state.failures.find(
    (entry) => entry.fingerprint === fingerprint,
  );
  const failures =
    existing === undefined
      ? [
          ...state.failures,
          {
            stepId: failure.stepId,
            fingerprint,
            code: failure.code,
            repeatCount: 1,
          },
        ]
      : state.failures.map((entry) =>
          entry.fingerprint === fingerprint
            ? { ...entry, repeatCount: entry.repeatCount + 1 }
            : entry,
        );
  const exhausted = failures.some(
    (entry) => entry.repeatCount > state.repairLimit,
  );
  const next: TaskState = {
    ...state,
    attempt: state.attempt + 1,
    failures,
    updatedAt: now.toISOString(),
  };

  if (!exhausted) return next;
  if (state.phase !== "repairing" && state.phase !== "verifying") return next;

  return transition(next, "escalated", {
    now,
    reason: `repair limit reached for ${failure.stepId}`,
    stopReason: "task.repair-limit",
  });
}

export function recordSuccess(
  state: TaskState,
  now: Date = new Date(),
): TaskState {
  return {
    ...state,
    attempt: state.attempt + 1,
    failures: [],
    updatedAt: now.toISOString(),
  };
}

export type BeginTaskInput = Readonly<{
  root: string;
  planPath: string;
  planSource: string;
  changedPaths: readonly string[];
  repositoryIdentity: string;
  baseRevision: string;
  now?: Date;
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

  const plan = parsePlan(input.planPath, "active", input.planSource);

  if (plan.taskId !== taskId) {
    throw new Error(
      `plan declares task id "${plan.taskId}" but the file name derives "${taskId}"`,
    );
  }

  const declaredRisk = declaredRiskFromPlan(input.planSource);
  const maximumRisk = riskFromPlan(plan, "Maximum risk", declaredRisk);
  const { risk, rules } = effectiveRisk(declaredRisk, input.changedPaths);
  const lanes = selectLanes(risk, input.changedPaths);
  const authority = listFromPlan(plan, "Authority");
  const now = (input.now ?? new Date()).toISOString();

  return transition(
    {
      version: TASK_STATE_VERSION,
      taskId,
      planPath: input.planPath,
      declaredRisk,
      effectiveRisk: risk,
      maximumRisk,
      rules,
      lane: lanes.lane,
      authority,
      authorityHash: authorityHash(authority),
      allowedPaths: listFromPlan(plan, "Allowed paths"),
      allowedActions: listFromPlan(plan, "Allowed actions"),
      repairLimit: Number(
        plan.headers["Repair limit"] ?? String(DEFAULT_REPAIR_LIMIT),
      ),
      taskTimeoutSeconds: parseTimeoutSeconds(plan.headers["Task timeout"]),
      repositoryIdentity: input.repositoryIdentity,
      baseRevision: input.baseRevision,
      preexistingPaths: [...input.changedPaths].sort(),
      phase: "queued",
      attempt: 0,
      failures: [],
      history: [],
      updatedAt: now,
    },
    "authorized",
    { now: input.now, reason: "task begun from an active plan" },
  );
}
