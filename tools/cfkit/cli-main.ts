import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assertFlags, flagValue, requireFlagValue } from "./cli-args.ts";
import {
  classifyChange,
  formatClassification,
  REVISION_PATTERN,
} from "./ci-classify.ts";
import { runHandoff } from "./commands-handoff.ts";
import { runRemove } from "./commands-remove.ts";
import { runScaffold } from "./commands-scaffold.ts";
import { runTask } from "./commands-task.ts";
import { evaluateDoctor, gatherDoctorFacts } from "./doctor.ts";
import {
  formatLedgerReport,
  LEDGER_PATH,
  parseLedger,
  validateLedger,
} from "./evidence.ts";
import { formatOracleReport, ORACLES, validateOracles } from "./oracles.ts";
import { formatPlanReport, listPlans, validatePlans } from "./plans.ts";
import { expandProfile, resolveProfile } from "./profiles.ts";
import { runProfile } from "./runner.ts";
import { UsageError } from "./usage-error.ts";

export const USAGE = `cfkit <command>

Commands:
  verify [--profile fast|full|runtime|smoke|ci]
                                 Run a verify profile (default: fast)
  budget:check                   Delegate to scripts/budget/check.mjs
  contract:check                 Delegate to scripts/contract/check.mjs
  contract:lint                  Delegate to scripts/contract/lint.mjs
  harness:parity                 Validate the harness-parity manifest
  oracles check                  Validate the end-to-end oracle registry
  plans check                    Validate the exec-plan contract (docs/exec-plans/)
  evidence check                 Validate the operating-evidence ledger
  ci classify --base <sha> --head <sha>
                                 Print effective_risk and runtime_required for a diff
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

Exit codes: 0 success, 1 error, 2 usage error.
`;

function runScript(script: string): number {
  const result = spawnSync("node", [script], { stdio: "inherit" });

  return result.status ?? 1;
}

function runCi(args: readonly string[]): number {
  const [subcommand, ...rest] = args;

  if (subcommand !== "classify") {
    throw new UsageError(
      `unknown ci subcommand "${subcommand ?? ""}" (expected classify)`,
    );
  }

  assertFlags(
    rest,
    { "--base": "value", "--head": "value" },
    {
      maxPositionals: 0,
    },
  );

  const base = requireFlagValue(rest, "--base");
  const head = requireFlagValue(rest, "--head");

  if (!REVISION_PATTERN.test(base) || !REVISION_PATTERN.test(head)) {
    throw new UsageError(
      "--base and --head must be 40-64 character hex revisions",
    );
  }

  const result = classifyChange({ root: process.cwd(), base, head });

  // stdout is the machine interface (CI appends it to $GITHUB_OUTPUT); detail goes to stderr.
  process.stdout.write(formatClassification(result));
  console.error(
    `[cfkit] ci classify: ${String(result.changedPaths.length)} changed paths; risk ${result.effectiveRisk}${result.declaredRisk === undefined ? "" : ` (declared ${result.declaredRisk})`}; rules ${result.rules.join(", ") || "none"}; reasons ${result.reasons.join(", ") || "none"}; lane ${result.lane}`,
  );

  return 0;
}

async function runVerify(args: readonly string[]): Promise<number> {
  assertFlags(args, { "--profile": "value" }, { maxPositionals: 0 });

  const requested = flagValue(args, "--profile") ?? "fast";
  const profile = resolveProfile(requested);

  if (profile === undefined) {
    throw new UsageError(
      `unknown profile "${requested}" (expected fast|full|runtime|smoke|ci)`,
    );
  }

  console.log(`[cfkit] verify --profile ${profile.name}`);

  const result = await runProfile({
    name: profile.name,
    steps: expandProfile(profile.name),
  });

  if (result.exitCode !== 0) {
    console.error(
      `[cfkit] profile ${profile.name} failed at ${result.results.at(-1)?.id ?? "unknown"}`,
    );

    return 1;
  }

  console.log(`[cfkit] profile ${profile.name} passed`);

  return 0;
}

function runDoctor(): number {
  const checks = evaluateDoctor(gatherDoctorFacts(process.cwd()));

  for (const check of checks) {
    console.log(`  [${check.status}] ${check.name}: ${check.detail}`);
  }

  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

type CommandHandler = (args: readonly string[]) => number | Promise<number>;

const COMMAND_HANDLERS: Readonly<Record<string, CommandHandler>> = {
  ci: runCi,
  verify: runVerify,
  "budget:check": (args) => {
    assertFlags(args, {}, { maxPositionals: 0 });

    return runScript("scripts/budget/check.mjs");
  },
  "contract:check": (args) => {
    assertFlags(args, {}, { maxPositionals: 0 });

    return runScript("scripts/contract/check.mjs");
  },
  "contract:lint": (args) => {
    assertFlags(args, {}, { maxPositionals: 0 });

    return runScript("scripts/contract/lint.mjs");
  },
  "harness:parity": (args) => {
    assertFlags(args, {}, { maxPositionals: 0 });

    return runScript("scripts/parity/harness.mjs");
  },
  evidence: (args) => {
    const [subcommand, ...rest] = args;

    if (subcommand !== "check") {
      throw new UsageError(
        `unknown evidence subcommand "${subcommand ?? ""}" (expected check)`,
      );
    }

    assertFlags(rest, {}, { maxPositionals: 0 });

    const root = process.cwd();
    const source = readFileSync(join(root, LEDGER_PATH), "utf8");
    const ledger = parseLedger(source);
    const problems = validateLedger(ledger, Buffer.byteLength(source, "utf8"));

    console.log(formatLedgerReport(ledger));

    if (problems.length > 0) {
      console.error("[evidence] violations:");
      for (const problem of problems) console.error(`  x ${problem}`);

      return 1;
    }

    console.log("[evidence] all checks passed");

    return 0;
  },
  plans: (args) => {
    const [subcommand, ...rest] = args;

    if (subcommand !== "check") {
      throw new UsageError(
        `unknown plans subcommand "${subcommand ?? ""}" (expected check)`,
      );
    }

    assertFlags(rest, {}, { maxPositionals: 0 });

    const plans = listPlans(process.cwd());
    const problems = validatePlans(plans);

    console.log(formatPlanReport(plans));

    if (problems.length > 0) {
      console.error("[plans] violations:");
      for (const problem of problems) console.error(`  x ${problem}`);

      return 1;
    }

    console.log("[plans] all checks passed");

    return 0;
  },
  oracles: (args) => {
    const [subcommand, ...rest] = args;

    if (subcommand !== "check") {
      throw new UsageError(
        `unknown oracles subcommand "${subcommand ?? ""}" (expected check)`,
      );
    }

    assertFlags(rest, {}, { maxPositionals: 0 });

    const problems = validateOracles(ORACLES, process.cwd());

    console.log(formatOracleReport(ORACLES));

    if (problems.length > 0) {
      console.error("[oracles] violations:");
      for (const problem of problems) console.error(`  x ${problem}`);

      return 1;
    }

    console.log("[oracles] all checks passed");

    return 0;
  },
  doctor: (args) => {
    assertFlags(args, {}, { maxPositionals: 0 });

    return runDoctor();
  },
  scaffold: runScaffold,
  remove: runRemove,
  task: (args) => runTask(args, process.cwd()),
  handoff: (args) => runHandoff(args, process.cwd()),
};

export async function main(args: readonly string[]): Promise<number> {
  const [command, ...rest] = args;

  if (command === undefined) {
    console.error(USAGE);

    return 2;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE);

    return 0;
  }

  try {
    const handler = COMMAND_HANDLERS[command];

    if (handler === undefined) {
      throw new UsageError(`unknown command "${command}"`);
    }

    return await handler(rest);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`[cfkit] ${error.message}`);
      console.error("Run `npm run cfkit -- --help` for usage.");

      return 2;
    }

    console.error(
      `[cfkit] ${error instanceof Error ? error.message : String(error)}`,
    );

    return 1;
  }
}
