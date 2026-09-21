import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { formatPaths } from "./format.ts";
import { applyRemovePlan } from "./remove-apply.ts";
import {
  buildEndpointRemoval,
  buildFeatureRemoval,
  type RemovePlan,
} from "./remove.ts";
import type { RepoAccess } from "./scaffold.ts";

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

export function runRemove(args: readonly string[]): number {
  const subcommand = args[0];
  const root = process.cwd();
  const flags = new Set(args.slice(1).filter((arg) => arg.startsWith("--")));

  try {
    let plan: RemovePlan;

    if (subcommand === "endpoint") {
      plan = buildEndpointRemoval({
        operationId: args[1] ?? "",
        repo: repoAccess(root),
      });
    } else if (subcommand === "feature") {
      if (!flags.has("--yes")) {
        console.error(
          "[cfkit] refusing to remove a feature without --yes (nothing was changed)",
        );

        return 1;
      }

      plan = buildFeatureRemoval({
        rawName: args[1] ?? "",
        repo: repoAccess(root),
        forceCore: flags.has("--force-core"),
        force: flags.has("--force"),
      });
    } else {
      console.error(
        `[cfkit] unknown remove target "${subcommand ?? ""}" (expected feature|endpoint)`,
      );

      return 1;
    }

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
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[cfkit] remove refused: ${message}`);

    return 1;
  }

  console.log("[cfkit] remove applied");

  return 0;
}
