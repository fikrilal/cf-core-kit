import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { validateLedger } from "./evidence.ts";
import { ORACLES, validateOracles } from "./oracles.ts";
import { listPlans, validatePlans } from "./plans.ts";
import { TASK_PHASES, TASK_STATE_VERSION } from "./task-state.ts";
import { WORKSPACE_STATE_VERSION } from "./workspace.ts";

/**
 * The doctor is a read-only readiness report: what would stop a task before it starts. Hard failures are
 * things the harness cannot work around (missing tools, a working directory that is not the repository root,
 * private state that is not ignored, policy or state files that do not validate); warnings are things a
 * maintainer should know (a version drift, an unavailable dev tool, tasks that have gone quiet).
 */
export const STALE_TASK_DAYS = 7;
export const TERMINAL_STATE_PHASES: readonly string[] = [
  "cancelled",
  "failed",
  "handed_off",
];
export const KNOWN_PHASES: readonly string[] = TASK_PHASES;

export type DoctorStatus = "ok" | "warn" | "fail";

export type DoctorCheck = Readonly<{
  name: string;
  status: DoctorStatus;
  detail: string;
}>;

export type TaskStateReport = Readonly<{
  problems: readonly string[];
  stale: readonly string[];
}>;

export type DoctorFacts = Readonly<{
  nodeVersion: string;
  nvmrcVersion: string | undefined;
  hasNodeModules: boolean;
  wranglerConfig: string | undefined;
  budgetScriptPresent: boolean;
  migrationsDirPresent: boolean;
  gitVersion: string | undefined;
  canonicalRoot: string | undefined;
  projectRoot: string;
  privateStateIgnored: boolean;
  policyProblems: readonly string[];
  stateProblems: readonly string[];
  staleTasks: readonly string[];
  wranglerAvailable: boolean;
}>;

function readIfPresent(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function run(command: string, args: readonly string[], root: string) {
  return spawnSync(command, [...args], { cwd: root, encoding: "utf8" });
}

function canonicalRoot(root: string): string | undefined {
  const result = run("git", ["rev-parse", "--show-toplevel"], root);

  if (result.status !== 0) return undefined;

  try {
    return realpathSync(result.stdout.trim());
  } catch {
    return undefined;
  }
}

/**
 * Task and workspace states, read straight from disk: the doctor migrates nothing and fixes nothing — it
 * reports what the harness would refuse to work with (an unknown phase, a schema it does not understand, a
 * manifest belonging to another task) and what a maintainer should look at (a task that has gone quiet).
 */
function taskStateIssues(
  taskId: string,
  statePath: string,
  now: Date,
): Readonly<{ problems: readonly string[]; stale: readonly string[] }> {
  const problems: string[] = [];
  const stale: string[] = [];

  if (!existsSync(statePath)) return { problems, stale };

  try {
    const raw: unknown = JSON.parse(readFileSync(statePath, "utf8"));
    const state = raw as Record<string, unknown>;

    // A superseded schema is a warning, not a failure: `readTaskState` migrates it on read.
    if (state.version !== TASK_STATE_VERSION) {
      stale.push(
        `${taskId}: state schema ${String(state.version)} (migrated on read)`,
      );
    }
    if (state.taskId !== taskId) {
      problems.push(
        `${taskId}: state declares task id "${String(state.taskId)}"`,
      );
    }
    if (!KNOWN_PHASES.includes(String(state.phase))) {
      problems.push(`${taskId}: unknown phase "${String(state.phase)}"`);
    }

    const updatedAt = Date.parse(String(state.updatedAt));
    const ageDays = Number.isNaN(updatedAt)
      ? undefined
      : (now.getTime() - updatedAt) / 86_400_000;

    if (
      ageDays !== undefined &&
      ageDays > STALE_TASK_DAYS &&
      !TERMINAL_STATE_PHASES.includes(String(state.phase))
    ) {
      stale.push(
        `${taskId}: ${String(state.phase)} for ${String(Math.floor(ageDays))} days`,
      );
    }
  } catch {
    problems.push(`${taskId}: state.json is not readable JSON`);
  }

  return { problems, stale };
}

function workspaceIssues(taskId: string, root: string): readonly string[] {
  const manifestSource = readIfPresent(
    join(root, ".cfkit", "tasks", taskId, "workspace.json"),
  );

  if (manifestSource === undefined) return [];

  try {
    const manifest = JSON.parse(manifestSource) as Record<string, unknown>;
    const problems: string[] = [];

    if (manifest.schemaVersion !== WORKSPACE_STATE_VERSION) {
      problems.push(
        `${taskId}: workspace schema ${String(manifest.schemaVersion)} is not ${String(WORKSPACE_STATE_VERSION)}`,
      );
    }
    if (manifest.taskId !== taskId) {
      problems.push(
        `${taskId}: workspace.json belongs to "${String(manifest.taskId)}"`,
      );
    }

    return problems;
  } catch {
    return [`${taskId}: workspace.json is not readable JSON`];
  }
}

export function readTaskStateReport(
  root: string,
  now: Date = new Date(),
): TaskStateReport {
  const directory = join(root, ".cfkit", "tasks");

  if (!existsSync(directory)) return { problems: [], stale: [] };

  const problems: string[] = [];
  const stale: string[] = [];

  for (const taskId of readdirSync(directory)) {
    const state = taskStateIssues(
      taskId,
      join(directory, taskId, "state.json"),
      now,
    );

    problems.push(...state.problems, ...workspaceIssues(taskId, root));
    stale.push(...state.stale);
  }

  return { problems, stale };
}

function policyProblems(root: string): readonly string[] {
  const problems: string[] = [...validatePlans(listPlans(root))];

  try {
    problems.push(...validateOracles(ORACLES, root));
  } catch {
    problems.push("oracles: registry could not be validated");
  }

  try {
    const source = readFileSync(
      join(root, "docs/engineering/operating-evidence-ledger.json"),
      "utf8",
    );

    problems.push(
      ...validateLedger(JSON.parse(source), Buffer.byteLength(source, "utf8")),
    );
  } catch {
    problems.push("evidence: ledger could not be read");
  }

  return problems.map((problem) => `policy: ${problem}`);
}

export function gatherDoctorFacts(root: string): DoctorFacts {
  const gitVersion = run("git", ["--version"], root);
  const wrangler = run("npx", ["--no-install", "wrangler", "--version"], root);
  const ignore = run("git", ["check-ignore", "-q", ".cfkit"], root);
  const states = readTaskStateReport(root);

  return {
    nodeVersion: process.versions.node,
    nvmrcVersion: readIfPresent(join(root, ".nvmrc"))?.trim(),
    hasNodeModules: existsSync(join(root, "node_modules")),
    wranglerConfig: readIfPresent(join(root, "wrangler.jsonc")),
    budgetScriptPresent: existsSync(
      join(root, "scripts", "budget", "check.mjs"),
    ),
    migrationsDirPresent: existsSync(join(root, "db", "migrations")),
    gitVersion: gitVersion.status === 0 ? gitVersion.stdout.trim() : undefined,
    canonicalRoot: canonicalRoot(root),
    projectRoot: realpathSync(root),
    privateStateIgnored: ignore.status === 0,
    policyProblems: policyProblems(root),
    stateProblems: states.problems,
    staleTasks: states.stale,
    wranglerAvailable: wrangler.status === 0,
  };
}

function checkNodeVersion(facts: DoctorFacts): DoctorCheck {
  const expectedMajor = facts.nvmrcVersion?.split(".")[0];
  const actualMajor = facts.nodeVersion.split(".")[0];

  if (expectedMajor !== undefined && expectedMajor === actualMajor) {
    return {
      name: "node version",
      status: "ok",
      detail: `v${facts.nodeVersion} matches .nvmrc`,
    };
  }

  return {
    name: "node version",
    status: "warn",
    detail: `v${facts.nodeVersion} vs .nvmrc ${facts.nvmrcVersion ?? "missing"}`,
  };
}

function checkRoot(facts: DoctorFacts): DoctorCheck {
  if (facts.canonicalRoot === undefined) {
    return {
      name: "canonical root",
      status: "fail",
      detail: "not inside a git work tree",
    };
  }
  if (facts.canonicalRoot !== facts.projectRoot) {
    return {
      name: "canonical root",
      status: "fail",
      detail: `working directory ${facts.projectRoot} is not the repository root ${facts.canonicalRoot}`,
    };
  }

  return { name: "canonical root", status: "ok", detail: facts.projectRoot };
}

function checkProblems(name: string, problems: readonly string[]): DoctorCheck {
  return problems.length === 0
    ? { name, status: "ok", detail: "valid" }
    : {
        name,
        status: "fail",
        detail: `${String(problems.length)} problem(s): ${problems[0] ?? ""}`,
      };
}

export function evaluateDoctor(facts: DoctorFacts): readonly DoctorCheck[] {
  return [
    checkNodeVersion(facts),
    facts.gitVersion === undefined
      ? { name: "git", status: "fail", detail: "git is not available" }
      : { name: "git", status: "ok", detail: facts.gitVersion },
    checkRoot(facts),
    facts.hasNodeModules
      ? { name: "dependencies", status: "ok", detail: "node_modules present" }
      : {
          name: "dependencies",
          status: "fail",
          detail: "node_modules missing; run npm install",
        },
    facts.privateStateIgnored
      ? {
          name: "private state ignored",
          status: "ok",
          detail: ".cfkit/ is git-ignored",
        }
      : {
          name: "private state ignored",
          status: "fail",
          detail:
            ".cfkit/ is not git-ignored; task state and episodes would be committed",
        },
    facts.wranglerConfig?.includes('"main"') === true
      ? {
          name: "wrangler config",
          status: "ok",
          detail: "wrangler.jsonc present",
        }
      : {
          name: "wrangler config",
          status: "fail",
          detail: "wrangler.jsonc missing or unreadable",
        },
    checkProblems("policy schemas", facts.policyProblems),
    checkProblems("task and workspace state", facts.stateProblems),
    facts.budgetScriptPresent
      ? {
          name: "budget checks",
          status: "ok",
          detail: "scripts/budget/check.mjs present",
        }
      : {
          name: "budget checks",
          status: "fail",
          detail: "scripts/budget/check.mjs missing",
        },
    facts.migrationsDirPresent
      ? { name: "migrations", status: "ok", detail: "db/migrations present" }
      : { name: "migrations", status: "warn", detail: "db/migrations missing" },
    facts.wranglerAvailable
      ? {
          name: "wrangler toolchain",
          status: "ok",
          detail: "wrangler is available",
        }
      : {
          name: "wrangler toolchain",
          status: "warn",
          detail:
            "wrangler is not available (the build and runtime profiles will fail)",
        },
    facts.staleTasks.length === 0
      ? { name: "task recency", status: "ok", detail: "no quiet tasks" }
      : {
          name: "task recency",
          status: "warn",
          detail: `quiet for more than ${String(STALE_TASK_DAYS)} days: ${facts.staleTasks.join("; ")}`,
        },
  ];
}
