import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type HandoffAction = "commit" | "push" | "draft-pr";

export const HANDOFF_ACTIONS: readonly HandoffAction[] = [
  "commit",
  "push",
  "draft-pr",
];

export const HANDOFF_LIFETIME_MS = 15 * 60_000;

export type HandoffApproval = Readonly<{
  version: 1;
  taskId: string;
  action: HandoffAction;
  status: "prepared" | "uncertain";
  createdAt: number;
  expiresAt: number;
  changedPaths: readonly string[];
  taskFingerprint: string;
  challengeHash: string;
}>;

export function challengeHash(challenge: string): string {
  return createHash("sha256").update(challenge).digest("hex");
}

export function approvalPath(taskId: string, action: HandoffAction): string {
  return join(".cfkit", "tasks", taskId, "handoff", `${action}.json`);
}

export function createApproval(
  input: Readonly<{
    taskId: string;
    action: HandoffAction;
    changedPaths: readonly string[];
    taskFingerprint: string;
    challenge: string;
    nowMs: number;
  }>,
): HandoffApproval {
  return {
    version: 1,
    taskId: input.taskId,
    action: input.action,
    status: "prepared",
    createdAt: input.nowMs,
    expiresAt: input.nowMs + HANDOFF_LIFETIME_MS,
    changedPaths: [...input.changedPaths],
    taskFingerprint: input.taskFingerprint,
    challengeHash: challengeHash(input.challenge),
  };
}

export type ApprovalVerdict =
  Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

function samePaths(a: readonly string[], b: readonly string[]): boolean {
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();

  return (
    sortedA.length === sortedB.length &&
    sortedA.every((path, index) => path === sortedB[index])
  );
}

export function verifyApproval(
  input: Readonly<{
    approval: HandoffApproval | undefined;
    action: HandoffAction;
    challenge: string;
    nowMs: number;
    changedPaths: readonly string[];
    taskFingerprint: string;
  }>,
): ApprovalVerdict {
  const approval = input.approval;

  if (approval === undefined) {
    return {
      ok: false,
      reason: "no prepared approval; run `cfkit handoff dry-run` first",
    };
  }

  if (approval.status !== "prepared") {
    return {
      ok: false,
      reason:
        "approval is not prepared; inspect local and remote state before any retry",
    };
  }

  if (approval.action !== input.action) {
    return { ok: false, reason: "approval was issued for a different action" };
  }

  if (approval.expiresAt <= input.nowMs) {
    return { ok: false, reason: "approval expired; run dry-run again" };
  }

  if (approval.challengeHash !== challengeHash(input.challenge)) {
    return {
      ok: false,
      reason: "challenge does not match the prepared approval",
    };
  }

  if (approval.taskFingerprint !== input.taskFingerprint) {
    return {
      ok: false,
      reason:
        "approval is stale (revision or paths changed); run dry-run again",
    };
  }

  if (!samePaths(approval.changedPaths, input.changedPaths)) {
    return {
      ok: false,
      reason: "approval is stale (changed paths differ); run dry-run again",
    };
  }

  return { ok: true };
}

export function markUncertain(approval: HandoffApproval): HandoffApproval {
  return { ...approval, status: "uncertain" };
}

export function readApproval(
  root: string,
  taskId: string,
  action: HandoffAction,
): HandoffApproval | undefined {
  const path = join(root, approvalPath(taskId, action));

  if (!existsSync(path)) return undefined;

  return JSON.parse(readFileSync(path, "utf8")) as HandoffApproval;
}

export function writeApproval(root: string, approval: HandoffApproval): string {
  const relative = approvalPath(approval.taskId, approval.action);
  const path = join(root, relative);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(approval, null, 2)}\n`, {
    mode: 0o600,
  });

  return relative;
}
