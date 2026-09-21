import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { formatPaths } from "./format.ts";
import { applyScaffoldPlan } from "./scaffold-apply.ts";
import { buildEndpointScaffold } from "./scaffold-endpoint.ts";
import { buildFeatureScaffold, type ScaffoldPlan } from "./scaffold.ts";
import { spawnSync } from "node:child_process";

export function readKnownErrorCodes(root: string): ReadonlySet<string> {
  const source = readFileSync(join(root, "src/shared/error-codes.ts"), "utf8");
  const codes = [...source.matchAll(/^\s*([A-Z][A-Z0-9_]+) = /gm)].map(
    (match) => match[1] ?? "",
  );

  return new Set(codes);
}

export function readKnownTags(root: string): ReadonlySet<string> {
  const source = readFileSync(
    join(root, "tools/contract/emit.entry.ts"),
    "utf8",
  );
  const start = source.indexOf("const TAG_REGISTRY = [");
  const end = source.indexOf("];", start);
  const region = start === -1 || end === -1 ? "" : source.slice(start, end);
  const names = [...region.matchAll(/name: "([A-Za-z]+)"/g)].map(
    (match) => match[1] ?? "",
  );

  return new Set(names);
}

function printPlan(plan: ScaffoldPlan): void {
  console.log(`[cfkit] scaffold ${plan.kind}: ${plan.description}`);
  for (const file of plan.files) console.log(`  create ${file.path}`);
  for (const edit of plan.edits) console.log(`  edit   ${edit.path}`);
  if (plan.moveOperation !== undefined) {
    console.log(`  manifest ${plan.moveOperation}: pending -> implemented`);
  }
}

export function runScaffold(args: readonly string[]): number {
  const subcommand = args[0];
  const root = process.cwd();

  try {
    if (subcommand === "feature") {
      const plan = buildFeatureScaffold(args[1] ?? "", {
        exists: (path) => existsSync(join(root, path)),
        existingFeatures: () =>
          readdirSync(join(root, "src/features"), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name),
      });

      printPlan(plan);
      applyScaffoldPlan(root, plan, { format: formatPaths });
    } else if (subcommand === "endpoint") {
      const plan = buildEndpointScaffold({
        operationId: args[1] ?? "",
        snapshotYaml: readFileSync(
          join(root, "contracts/backend.openapi.yaml"),
          "utf8",
        ),
        coverageJson: readFileSync(
          join(root, "tools/parity/coverage.json"),
          "utf8",
        ),
        appSource: readFileSync(join(root, "src/app.ts"), "utf8"),
        emitterSource: readFileSync(
          join(root, "tools/contract/emit.entry.ts"),
          "utf8",
        ),
        knownErrorCodes: readKnownErrorCodes(root),
        knownTags: readKnownTags(root),
        featureExists: (feature) =>
          existsSync(join(root, "src/features", feature)),
      });

      printPlan(plan);
      applyScaffoldPlan(root, plan, { format: formatPaths });

      const emitted = spawnSync("node", ["scripts/contract/emit.mjs"], {
        stdio: "inherit",
      });

      if (emitted.status !== 0) {
        console.error("[cfkit] contract emit failed after scaffolding");

        return emitted.status ?? 1;
      }
    } else {
      console.error(
        `[cfkit] unknown scaffold target "${subcommand ?? ""}" (expected feature|endpoint)`,
      );

      return 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.error(`[cfkit] scaffold refused: ${message}`);

    return 1;
  }

  console.log("[cfkit] scaffold applied");

  return 0;
}
