import { spawnSync } from "node:child_process";

import type { VerifyProfile } from "./profiles.ts";

export type StepRunner = (script: string) => number;

export type StepResult = Readonly<{
  id: string;
  status: "passed" | "failed";
  durationMs: number;
}>;

export type ProfileRunResult = Readonly<{
  profile: string;
  results: readonly StepResult[];
  exitCode: number;
}>;

export function defaultStepRunner(script: string): number {
  const result = spawnSync("npm", ["run", script], { stdio: "inherit" });

  return result.status ?? 1;
}

function reportStep(
  id: string,
  status: StepResult["status"],
  durationMs: number,
): void {
  const seconds = (durationMs / 1000).toFixed(1);
  const marker = status === "passed" ? "\u2713" : "x";

  console.log(`  ${marker} ${id} (${seconds}s)`);
}

export function runProfile(
  profile: VerifyProfile,
  runStep: StepRunner = defaultStepRunner,
): ProfileRunResult {
  const results: StepResult[] = [];

  for (const step of profile.steps) {
    const start = Date.now();
    const exitCode = runStep(step);
    const durationMs = Date.now() - start;
    const status = exitCode === 0 ? "passed" : "failed";

    results.push({ id: step, status, durationMs });
    reportStep(step, status, durationMs);

    if (exitCode !== 0) {
      return { profile: profile.name, results, exitCode };
    }
  }

  return { profile: profile.name, results, exitCode: 0 };
}
