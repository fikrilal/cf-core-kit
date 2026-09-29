import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { assertFlags } from "./cli-args.ts";
import { formatPaths } from "./format.ts";
import { applyRemovePlan } from "./remove-apply.ts";
import {
  buildEndpointRemoval,
  buildFeatureRemoval,
  type RemovePlan,
} from "./remove.ts";
import type { RepoAccess } from "./scaffold.ts";
import { UsageError } from "./usage-error.ts";

export function repoAccess(root: string): RepoAccess {
  const list = (dir: string): readonly string[] => {
    const files: string[] = [];
    const walk = (current: string): void => {
      for (const entry of readdirSync(join(root, current), {
        withFileTypes: true,
      })) {
        const relative = `${current}/${entry.name}`;

        if (entry.isDirectory()) walk(relative);
        else files.push(relative);
      }
    };

    walk(dir);

    return files;
  };

  return {
    read: (path) => readFileSync(join(root, path), "utf8"),
    exists: (path) => existsSync(join(root, path)),
    list,
    featureNames: () =>
      readdirSync(join(root, "src/features"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name),
  };
}

function printRemovePlan(plan: RemovePlan): void {
  console.log(`[cfkit] remove ${plan.kind}: ${plan.description}`);
  for (const file of plan.deleteFiles) console.log(`  delete ${file}`);
  for (const directory of plan.removeDirectories) {
    console.log(`  delete ${directory}/`);
  }
  for (const edit of plan.edits) console.log(`  edit   ${edit.path}`);
  for (const operation of plan.returnOperations) {
    console.log(`  manifest ${operation}: implemented -> pending`);
  }
}

function positionalTarget(subcommand: string, args: readonly string[]): string {
  const target = args.slice(1).find((arg) => !arg.startsWith("--"));

  if (target === undefined || target === "") {
    throw new UsageError(
      `remove ${subcommand} needs an argument (feature <name> | endpoint <operationId>)`,
    );
  }

  return target;
}

function removePreflight(
  subcommand: string,
  target: string,
  flags: ReadonlySet<string>,
): number | undefined {
  if (subcommand === "feature" && !flags.has("--yes")) {
    console.error(
      "[cfkit] refusing to remove a feature without --yes (nothing was changed)",
    );

    return 1;
  }

  return undefined;
}

function buildRemovePlan(
  subcommand: string,
  target: string,
  root: string,
  flags: ReadonlySet<string>,
): RemovePlan {
  if (subcommand !== "endpoint" && subcommand !== "feature") {
    throw new UsageError(
      `unknown remove target "${subcommand}" (expected feature|endpoint)`,
    );
  }

  if (subcommand === "endpoint") {
    return buildEndpointRemoval({
      operationId: target,
      repo: repoAccess(root),
    });
  }

  return buildFeatureRemoval({
    rawName: target,
    repo: repoAccess(root),
    forceCore: flags.has("--force-core"),
    force: flags.has("--force"),
  });
}

export function runRemove(args: readonly string[]): number {
  const subcommand = args[0];
  const root = process.cwd();
  const flagSpec = {
    "--yes": "boolean",
    "--force-core": "boolean",
    "--force": "boolean",
  } as const;
  const flags = new Set(args.slice(1).filter((arg) => arg.startsWith("--")));

  try {
    assertFlags(args.slice(1), flagSpec, { maxPositionals: 1 });

    const target = positionalTarget(subcommand ?? "<target>", args);
    const preflight = removePreflight(subcommand ?? "<target>", target, flags);

    if (preflight !== undefined) return preflight;

    const plan = buildRemovePlan(subcommand ?? "", target, root, flags);

    printRemovePlan(plan);
    applyRemovePlan(root, plan, { format: formatPaths });

    if (plan.returnOperations.length > 0) {
      const emitted = spawnSync("node", ["scripts/contract/emit.mjs"], {
        stdio: "inherit",
      });

      if (emitted.status !== 0) {
        console.error("[cfkit] contract emit failed after removal");

        return emitted.status ?? 1;
      }
    }
  } catch (error) {
    if (error instanceof UsageError) throw error;

    const message = error instanceof Error ? error.message : String(error);

    console.error(`[cfkit] remove refused: ${message}`);

    return 1;
  }

  console.log("[cfkit] remove applied");

  return 0;
}
