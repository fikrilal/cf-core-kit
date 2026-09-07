import { spawnSync } from "node:child_process";

import { evaluateDoctor, gatherDoctorFacts } from "./doctor.ts";
import { resolveProfile } from "./profiles.ts";
import { runProfile } from "./runner.ts";

const USAGE = `cfkit <command>

Commands:
  verify [--profile fast|full]   Run a verify profile (default: fast)
  budget:check                   Delegate to scripts/budget/check.mjs
  doctor                         Read-only repository readiness check
`;

function parseProfileArg(args: readonly string[]): string | undefined {
  const index = args.indexOf("--profile");

  return index === -1 ? undefined : args[index + 1];
}

function runVerify(args: readonly string[]): number {
  const requested = parseProfileArg(args) ?? "fast";
  const profile = resolveProfile(requested);

  if (profile === undefined) {
    console.error(
      `[cfkit] unknown profile "${requested}" (expected fast|full)`,
    );

    return 1;
  }

  console.log(`[cfkit] verify --profile ${profile.name}`);

  const result = runProfile(profile);

  if (result.exitCode !== 0) {
    console.error(
      `[cfkit] profile ${profile.name} failed at ${result.results.at(-1)?.id ?? "unknown"}`,
    );

    return result.exitCode;
  }

  console.log(`[cfkit] profile ${profile.name} passed`);

  return 0;
}

function runBudgetCheck(): number {
  const result = spawnSync("node", ["scripts/budget/check.mjs"], {
    stdio: "inherit",
  });

  return result.status ?? 1;
}

function runDoctor(): number {
  const checks = evaluateDoctor(gatherDoctorFacts(process.cwd()));

  for (const check of checks) {
    console.log(`  [${check.status}] ${check.name}: ${check.detail}`);
  }

  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

function main(args: readonly string[]): number {
  const command = args[0];

  if (command === undefined || command === "help" || command === "--help") {
    console.log(USAGE);

    return command === undefined ? 1 : 0;
  }

  if (command === "verify") return runVerify(args.slice(1));
  if (command === "budget:check") return runBudgetCheck();
  if (command === "doctor") return runDoctor();

  console.error(`[cfkit] unknown command "${command}"`);
  console.error(USAGE);

  return 1;
}

process.exitCode = main(process.argv.slice(2));
