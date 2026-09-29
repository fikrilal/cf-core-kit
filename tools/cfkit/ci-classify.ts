import { execFileSync } from "node:child_process";

import {
  effectiveRisk,
  RISK_ORDER,
  selectLanes,
  type RiskLevel,
} from "./risk-classifier.ts";
import { readDeclaredRisk } from "./task.ts";

export const REVISION_PATTERN = /^[0-9a-f]{40,64}$/;
export const PLAN_PATH_PATTERN =
  /^docs\/exec-plans\/(?:active|queued|completed)\/[^/]+\.md$/;

export type CiClassification = Readonly<{
  effectiveRisk: RiskLevel;
  runtimeRequired: boolean;
  lane: string;
  rules: readonly string[];
  reasons: readonly string[];
  declaredRisk: RiskLevel | undefined;
  changedPaths: readonly string[];
}>;

export function changedPathsBetween(
  root: string,
  base: string,
  head: string,
): readonly string[] {
  let output: string;

  try {
    output = execFileSync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACMRDT", `${base}...${head}`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    throw new Error(
      `cannot diff ${base}...${head} (fetch enough history first, e.g. fetch-depth: 0 in CI): ${detail}`,
      { cause: error },
    );
  }

  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .sort();
}

/** Reads the plan blob at `head`; a path deleted or renamed in the range is skipped. */
function planSourceAtHead(
  root: string,
  head: string,
  path: string,
): string | undefined {
  try {
    return execFileSync("git", ["show", `${head}:${path}`], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return undefined;
  }
}

export function declaredRiskFromChangedPlans(
  root: string,
  head: string,
  paths: readonly string[],
): RiskLevel | undefined {
  let declared: RiskLevel | undefined;

  for (const path of paths) {
    if (!PLAN_PATH_PATTERN.test(path)) continue;

    const source = planSourceAtHead(root, head, path);

    if (source === undefined) continue;

    const risk = readDeclaredRisk(source);

    if (risk === undefined) continue;
    if (declared === undefined || RISK_ORDER[risk] > RISK_ORDER[declared]) {
      declared = risk;
    }
  }

  return declared;
}

export function classifyChange(
  input: Readonly<{
    root: string;
    base: string;
    head: string;
  }>,
): CiClassification {
  const changedPaths = changedPathsBetween(input.root, input.base, input.head);
  const declaredRisk = declaredRiskFromChangedPlans(
    input.root,
    input.head,
    changedPaths,
  );
  const { risk, rules } = effectiveRisk(declaredRisk ?? "low", changedPaths);
  const lanes = selectLanes(risk, changedPaths);

  return {
    effectiveRisk: risk,
    runtimeRequired: lanes.runtimeRequired,
    lane: lanes.lane,
    rules,
    reasons: lanes.reasons,
    declaredRisk,
    changedPaths,
  };
}

export function formatClassification(result: CiClassification): string {
  return [
    `effective_risk=${result.effectiveRisk}`,
    `runtime_required=${result.runtimeRequired ? "true" : "false"}`,
    "",
  ].join("\n");
}
