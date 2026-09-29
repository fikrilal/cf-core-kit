import { durationAdvisory } from "./duration-policy.ts";
import {
  failureDescriptor,
  type FailureDescriptor,
} from "./failure-taxonomy.ts";
import { PROCESS_TIMEOUT_MS, runProcess } from "./process-runner.ts";
import type { VerifyProfile, VerifyStep } from "./profiles.ts";

export type StepRunner = (script: string) => number | Promise<number>;

export type StepResult = Readonly<{
  id: string;
  status: "passed" | "failed";
  durationMs: number;
  exitCode: number;
  descriptor?: FailureDescriptor;
}>;

export type ProfileRunResult = Readonly<{
  profile: string;
  results: readonly StepResult[];
  exitCode: number;
  durationMs: number;
}>;

export async function defaultStepRunner(script: string): Promise<number> {
  const capture = await runProcess({
    command: "npm",
    args: ["run", script],
    timeoutMs: PROCESS_TIMEOUT_MS,
  });

  return capture.exitCode;
}

function reportStep(result: StepResult): void {
  const seconds = (result.durationMs / 1000).toFixed(1);
  const marker = result.status === "passed" ? "\u2713" : "x";

  console.log(`  ${marker} ${result.id} (${seconds}s)`);

  if (result.descriptor !== undefined) {
    const verdict = result.descriptor.repairable ? "repairable" : "escalate";

    console.log(
      `    \u2192 ${result.descriptor.code}: ${result.descriptor.remediation} (${verdict})`,
    );
  }
}

export async function runProfile(
  profile: Readonly<{
    name: VerifyProfile["name"];
    steps: readonly VerifyStep[];
  }>,
  runStep: StepRunner = defaultStepRunner,
): Promise<ProfileRunResult> {
  const results: StepResult[] = [];
  const startedAt = Date.now();

  for (const step of profile.steps) {
    const start = Date.now();
    const exitCode = await runStep(step.script);
    const durationMs = Date.now() - start;
    const result: StepResult = {
      id: step.id,
      status: exitCode === 0 ? "passed" : "failed",
      durationMs,
      exitCode,
      ...(exitCode === 0 ? {} : { descriptor: failureDescriptor(step.id) }),
    };

    results.push(result);
    reportStep(result);

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
