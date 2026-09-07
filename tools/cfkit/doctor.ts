import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type DoctorStatus = "ok" | "warn" | "fail";

export type DoctorCheck = Readonly<{
  name: string;
  status: DoctorStatus;
  detail: string;
}>;

export type DoctorFacts = Readonly<{
  nodeVersion: string;
  nvmrcVersion: string | undefined;
  hasNodeModules: boolean;
  wranglerConfig: string | undefined;
  budgetScriptPresent: boolean;
  migrationsDirPresent: boolean;
}>;

function readIfPresent(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export function gatherDoctorFacts(root: string): DoctorFacts {
  return {
    nodeVersion: process.versions.node,
    nvmrcVersion: readIfPresent(join(root, ".nvmrc"))?.trim(),
    hasNodeModules: existsSync(join(root, "node_modules")),
    wranglerConfig: readIfPresent(join(root, "wrangler.jsonc")),
    budgetScriptPresent: existsSync(
      join(root, "scripts", "budget", "check.mjs"),
    ),
    migrationsDirPresent: existsSync(join(root, "db", "migrations")),
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

export function evaluateDoctor(facts: DoctorFacts): readonly DoctorCheck[] {
  return [
    checkNodeVersion(facts),
    facts.hasNodeModules
      ? { name: "dependencies", status: "ok", detail: "node_modules present" }
      : {
          name: "dependencies",
          status: "fail",
          detail: "node_modules missing; run npm install",
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
  ];
}
