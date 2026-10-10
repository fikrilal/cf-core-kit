import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parsePlan, type PlanFile } from "./plans.ts";
import { effectiveRisk, type RiskLevel } from "./risk-classifier.ts";
import { authorityHash, listFromPlan, type TaskState } from "./task-state.ts";

/**
 * Preflight answers one question before any work runs: *is this still the task the plan authorised?* Five
 * bindings, each with its own failure: the plan is still there and still declares this task; its `Authority`
 * list hashes to what the state recorded; the requested action is authorised; the paths the *task* touched are
 * inside `Allowed paths`; and the effective risk has not climbed past `Maximum risk`.
 */
export const CONTROLLER_ARTIFACT_PATTERNS: readonly RegExp[] = [
  /^_WIP\/.*\.md$/,
  /^\.cfkit\//,
  /^docs\/exec-plans\/(active|queued|completed)\//,
];

export function isControllerArtifact(path: string): boolean {
  return CONTROLLER_ARTIFACT_PATTERNS.some((pattern) => pattern.test(path));
}

export function pathAllowed(path: string, allowed: readonly string[]): boolean {
  return allowed.some(
    (entry) =>
      path === entry || path.startsWith(`${entry.replace(/\/$/, "")}/`),
  );
}

export type PreflightFacts = Readonly<{
  /** The plan source, or undefined when the plan file is gone. */
  planSource: string | undefined;
  planPath: string;
  changedPaths: readonly string[];
  repositoryIdentity: string;
  currentRevision: string;
}>;

export type PreflightReport = Readonly<{
  problems: readonly string[];
  notes: readonly string[];
  taskPaths: readonly string[];
  effectiveRisk: RiskLevel;
}>;

function authorityProblems(state: TaskState, plan: PlanFile): string[] {
  if (state.authorityHash === "") {
    return [
      "state predates the authority binding (schema 1): re-begin the task to bind it to the plan",
    ];
  }

  const expected = authorityHash(listFromPlan(plan, "Authority"));

  if (expected !== state.authorityHash) {
    return [
      `the plan's Authority changed since the task began (state ${state.authorityHash.slice(0, 12)}…, plan ${expected.slice(0, 12)}…)`,
    ];
  }

  return [];
}

export function evaluatePreflight(
  state: TaskState,
  facts: PreflightFacts,
  action: string,
): PreflightReport {
  const problems: string[] = [];
  const notes: string[] = [];
  const plan =
    facts.planSource === undefined
      ? undefined
      : parsePlan(facts.planPath, "active", facts.planSource);

  if (plan === undefined) {
    problems.push(`the plan is gone: ${facts.planPath}`);
  } else {
    if (plan.taskId !== state.taskId) {
      problems.push(
        `the plan at ${facts.planPath} now declares task id "${plan.taskId}"`,
      );
    }
    problems.push(...authorityProblems(state, plan));

    if (!state.allowedActions.includes(action)) {
      problems.push(
        `action "${action}" is not in the plan's Allowed actions (${state.allowedActions.join(", ") || "none"})`,
      );
    }
    if (state.allowedPaths.length === 0) {
      problems.push("the plan declares no Allowed paths");
    }
  }

  if (facts.repositoryIdentity !== state.repositoryIdentity) {
    problems.push(
      "this state belongs to a different repository or worktree than the one it began in",
    );
  }
  if (facts.currentRevision !== state.baseRevision) {
    notes.push(
      `revision moved since the task began: ${state.baseRevision.slice(0, 12)}… -> ${facts.currentRevision.slice(0, 12)}…`,
    );
  }

  const preexisting = new Set(state.preexistingPaths);
  const taskPaths = facts.changedPaths.filter(
    (path) => !preexisting.has(path) && !isControllerArtifact(path),
  );
  const escaped = taskPaths.filter(
    (path) => !pathAllowed(path, state.allowedPaths),
  );

  if (escaped.length > 0) {
    problems.push(`paths outside Allowed paths: ${escaped.join(", ")}`);
  }

  const { risk } = effectiveRisk(state.effectiveRisk, [
    ...state.preexistingPaths,
    ...taskPaths,
  ]);

  if (risk !== state.effectiveRisk) {
    notes.push(
      `effective risk re-classified ${state.effectiveRisk} -> ${risk} (the recorded risk is raise-only)`,
    );
  }
  if (riskOverMaximum(risk, state.maximumRisk)) {
    problems.push(
      `effective risk "${risk}" exceeds the plan's Maximum risk "${state.maximumRisk}"`,
    );
  }

  return { problems, notes, taskPaths, effectiveRisk: risk };
}

function riskOverMaximum(risk: RiskLevel, maximum: RiskLevel): boolean {
  const order = { low: 0, medium: 1, high: 2 } as const;

  return order[risk] > order[maximum];
}

export function readPlanSource(
  root: string,
  planPath: string,
): string | undefined {
  try {
    return readFileSync(join(root, planPath), "utf8");
  } catch {
    return undefined;
  }
}
