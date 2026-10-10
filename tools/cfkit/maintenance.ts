import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { acquireLock, isProcessAlive, readLock, releaseLock } from "./lock.ts";
import { defaultStepRunner, type StepRunner } from "./runner.ts";

/**
 * The maintenance registry: the read-only report steps a maintainer runs on demand, under the repository lock
 * so two runs cannot interleave. It deliberately reports rather than repairs — `smells:check` and
 * `duplication:report` write their own reports into the gitignored `_WIP/`, and this command writes one receipt
 * per run so "did it run, and what did it say" has an answer.
 */
export const MAINTENANCE_STEPS = [
  "plans:check",
  "smells:check",
  "duplication:report",
  "audit:prod",
] as const;
export const MAINTENANCE_DIRECTORY = ".cfkit/maintenance";
export const MAINTENANCE_RECEIPT_MODE = 0o600;

export type MaintenanceStepResult = Readonly<{
  id: string;
  exitCode: number;
  durationMs: number;
}>;

export type MaintenanceRun = Readonly<{
  steps: readonly MaintenanceStepResult[];
  exitCode: number;
  receiptPath: string | undefined;
  blockedBy: string | undefined;
}>;

function writeReceipt(
  root: string,
  run: Readonly<{ startedAt: string; steps: readonly MaintenanceStepResult[] }>,
): string {
  const directory = join(root, MAINTENANCE_DIRECTORY);

  mkdirSync(directory, { recursive: true, mode: 0o700 });

  const path = join(directory, `${run.startedAt.replaceAll(":", "-")}.json`);

  writeFileSync(
    path,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        startedAt: run.startedAt,
        steps: run.steps,
      },
      null,
      2,
    )}\n`,
    { mode: MAINTENANCE_RECEIPT_MODE },
  );

  return path;
}

export async function runMaintenance(
  root: string,
  options: Readonly<{
    runStep?: StepRunner;
    now?: Date;
    steps?: readonly string[];
  }> = {},
): Promise<MaintenanceRun> {
  const steps = options.steps ?? MAINTENANCE_STEPS;
  const startedAt = (options.now ?? new Date()).toISOString();
  const lock = acquireLock(root, { command: "maintenance run --once" });

  if (!lock.ok) {
    return {
      steps: [],
      exitCode: 1,
      receiptPath: undefined,
      blockedBy: lock.reason,
    };
  }

  const results: MaintenanceStepResult[] = [];
  const runStep = options.runStep ?? defaultStepRunner;

  try {
    for (const step of steps) {
      const start = Date.now();
      const outcome = await runStep(step);
      const exitCode = typeof outcome === "number" ? outcome : outcome.exitCode;

      results.push({ id: step, exitCode, durationMs: Date.now() - start });

      if (exitCode !== 0) break;
    }
  } finally {
    releaseLock(root, lock.handle);
  }

  const failed = results.some((step) => step.exitCode !== 0);
  const receiptPath = writeReceipt(root, { startedAt, steps: results });

  return {
    steps: results,
    exitCode: failed ? 1 : 0,
    receiptPath,
    blockedBy: undefined,
  };
}

export function formatMaintenanceReport(run: MaintenanceRun): string {
  const lines = [
    `[maintenance] steps ${String(run.steps.length)}; exit ${String(run.exitCode)}`,
  ];

  for (const step of run.steps) {
    lines.push(
      `[maintenance] ${step.exitCode === 0 ? "ok" : "failed"} ${step.id} (${(step.durationMs / 1000).toFixed(1)}s)`,
    );
  }

  if (run.receiptPath !== undefined) {
    lines.push(`[maintenance] receipt ${run.receiptPath}`);
  }
  if (run.blockedBy !== undefined) {
    lines.push(`[maintenance] blocked: ${run.blockedBy}`);
  }

  return lines.join("\n");
}

/** Exposed for the fixtures: a lock file written by a live pid must block a second run. */
export { isProcessAlive, readLock };
