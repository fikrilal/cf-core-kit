import { spawnSync } from "node:child_process";

import { durationAdvisory } from "./duration-policy.ts";
import type { VerifyProfile, VerifyStep } from "./profiles.ts";

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
  durationMs: number;
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
  profile: Readonly<{
    name: VerifyProfile["name"];
    steps: readonly VerifyStep[];
  }>,
  runStep: StepRunner = defaultStepRunner,
): ProfileRunResult {
  const results: StepResult[] = [];
  const startedAt = Date.now();

  for (const step of profile.steps) {
    const start = Date.now();
    const exitCode = runStep(step.script);
    const durationMs = Date.now() - start;
    const status = exitCode === 0 ? "passed" : "failed";
    const result: StepResult = { id: step.id, status, durationMs };

    results.push(result);
    reportStep(step.id, status, durationMs);

    if (exitCode !== 0) {
      return {
        profile: profile.name,
        results,
        exitCode,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  const durationMs = Date.now() - startedAt;
  const advisory = durationAdvisory(profile.name, durationMs);

  if (advisory !== undefined) console.log(`  ${advisory}`);

  return { profile: profile.name, results, exitCode: 0, durationMs };
}
