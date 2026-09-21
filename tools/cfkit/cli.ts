import { spawnSync } from "node:child_process";

import { runHandoff } from "./commands-handoff.ts";
import { runRemove } from "./commands-remove.ts";
import { runScaffold } from "./commands-scaffold.ts";
import { runTask } from "./commands-task.ts";
import { evaluateDoctor, gatherDoctorFacts } from "./doctor.ts";
import { expandProfile, resolveProfile } from "./profiles.ts";
import { runProfile } from "./runner.ts";

const USAGE = `cfkit <command>

Commands:
  verify [--profile fast|full|runtime|ci]
                                 Run a verify profile (default: fast)
  budget:check                   Delegate to scripts/budget/check.mjs
  contract:check                 Delegate to scripts/contract/check.mjs
  contract:lint                  Delegate to scripts/contract/lint.mjs
  doctor                         Read-only repository readiness check
  scaffold feature <name>        Generate a capability slice under src/features/
  scaffold endpoint <operationId>
                                 Generate an endpoint for a pending pinned operation
  remove endpoint <operationId>  Reverse an endpoint scaffold (marker-checked)
  remove feature <name> --yes    Reverse a feature scaffold (--force-core for auth/users)
  task begin --plan <path>       Track a task from an active exec plan
  task verify --task <id>        Run the task's lane profile with bounded repair
  task status --task <id>        Print the tracked task state
  handoff dry-run --task <id> --action commit|push|draft-pr
                                 Prepare an expiring, per-action approval
  handoff commit|push|draft-pr --task <id> --challenge <c>
                                 Execute one approved action (no merge/deploy)
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
      `[cfkit] unknown profile "${requested}" (expected fast|full|runtime|ci)`,
    );

    return 1;
  }

  console.log(`[cfkit] verify --profile ${profile.name}`);

  const result = runProfile({
    name: profile.name,
    steps: expandProfile(profile.name),
  });

  if (result.exitCode !== 0) {
    console.error(
      `[cfkit] profile ${profile.name} failed at ${result.results.at(-1)?.id ?? "unknown"}`,
    );

    return result.exitCode;
  }

  console.log(`[cfkit] profile ${profile.name} passed`);

  return 0;
}

function runScript(script: string): number {
  const result = spawnSync("node", [script], { stdio: "inherit" });

  return result.status ?? 1;
}

function runDoctor(): number {
  const checks = evaluateDoctor(gatherDoctorFacts(process.cwd()));

  for (const check of checks) {
    console.log(`  [${check.status}] ${check.name}: ${check.detail}`);
  }

  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

type CommandHandler = (args: readonly string[]) => number;

const COMMAND_HANDLERS: Readonly<Record<string, CommandHandler>> = {
  verify: runVerify,
  "budget:check": () => runScript("scripts/budget/check.mjs"),
  "contract:check": () => runScript("scripts/contract/check.mjs"),
  "contract:lint": () => runScript("scripts/contract/lint.mjs"),
  doctor: () => runDoctor(),
  scaffold: runScaffold,
  remove: runRemove,
  task: (args) => runTask(args, process.cwd()),
  handoff: (args) => runHandoff(args, process.cwd()),
};

function main(args: readonly string[]): number {
  const [command, ...rest] = args;

  if (command === undefined || command === "help" || command === "--help") {
    console.log(USAGE);

    return command === undefined ? 1 : 0;
  }

  const handler = COMMAND_HANDLERS[command];

  if (handler !== undefined) return handler(rest);

  console.error(`[cfkit] unknown command "${command}"`);
  console.error(USAGE);

  return 1;
}

process.exitCode = main(process.argv.slice(2));
