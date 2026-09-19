import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  readKnownErrorCodes,
  readKnownTags,
} from "../../tools/cfkit/commands-scaffold.ts";
import { buildEndpointScaffold } from "../../tools/cfkit/scaffold-endpoint.ts";
import { readCoverageManifest } from "../../tools/cfkit/scaffold.ts";

const ROOT = process.cwd();
const FEATURE = `smoke-slice-${randomUUID().slice(0, 8)}`;
const TOUCHED = [
  "src/app.ts",
  "tools/contract/emit.entry.ts",
  "tools/parity/coverage.json",
  "eslint.config.mjs",
  "docs/openapi/openapi.yaml",
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });

  return result.status ?? 1;
}

function cfkit(args) {
  return run("node", ["tools/cfkit/cli.ts", ...args]);
}

function fail(message) {
  console.error(`[scaffold-smoke] ${message}`);

  return 1;
}

let scaffoldedOperation;

function pickScaffoldableOperation() {
  const snapshotYaml = readFileSync(
    new URL("../../contracts/backend.openapi.yaml", import.meta.url),
    "utf8",
  );
  const coverageJson = readFileSync(
    new URL("../../tools/parity/coverage.json", import.meta.url),
    "utf8",
  );
  const appSource = readFileSync(
    new URL("../../src/app.ts", import.meta.url),
    "utf8",
  );
  const emitterSource = readFileSync(
    new URL("../../tools/contract/emit.entry.ts", import.meta.url),
    "utf8",
  );
  const manifest = readCoverageManifest(coverageJson);

  for (const operationId of manifest.pending) {
    try {
      buildEndpointScaffold({
        operationId,
        snapshotYaml,
        coverageJson,
        appSource,
        emitterSource,
        knownErrorCodes: readKnownErrorCodes(ROOT),
        knownTags: readKnownTags(ROOT),
        featureExists: (feature) =>
          existsSync(join(ROOT, "src/features", feature)),
      });

      return operationId;
    } catch {
      // not scaffoldable; try the next pending operation
    }
  }

  return undefined;
}

function verifyScaffoldedTree() {
  for (const script of [
    "format:check",
    "lint",
    "typecheck",
    "contract:check",
  ]) {
    const status = run("npm", ["run", script]);

    if (status !== 0) {
      console.error(`[scaffold-smoke] ${script} failed on the scaffolded tree`);

      return false;
    }
  }

  return true;
}

function captureBytes() {
  const before = new Map();

  for (const path of TOUCHED) {
    before.set(path, readFileSync(join(ROOT, path), "utf8"));
  }

  return before;
}

function restore(before) {
  cfkit(["remove", "feature", FEATURE, "--yes", "--force"]);

  if (scaffoldedOperation !== undefined) {
    cfkit(["remove", "endpoint", scaffoldedOperation]);
  }

  for (const path of TOUCHED) {
    if (readFileSync(join(ROOT, path), "utf8") !== before.get(path)) {
      writeFileSync(join(ROOT, path), before.get(path));
    }
  }
}

export function main() {
  const operation = pickScaffoldableOperation();

  if (operation === undefined) {
    return fail("no scaffoldable pending operation left");
  }

  scaffoldedOperation = operation;

  console.log(
    `[scaffold-smoke] scaffold feature ${FEATURE} + endpoint ${operation}`,
  );

  const before = captureBytes();

  try {
    if (cfkit(["scaffold", "feature", FEATURE]) !== 0) {
      return fail("feature scaffold failed");
    }

    if (cfkit(["scaffold", "endpoint", operation]) !== 0) {
      return fail("endpoint scaffold failed");
    }

    if (!verifyScaffoldedTree()) return 1;

    if (cfkit(["remove", "endpoint", operation]) !== 0) {
      return fail("endpoint removal failed");
    }

    if (cfkit(["remove", "feature", FEATURE, "--yes"]) !== 0) {
      return fail("feature removal failed");
    }

    const restored = TOUCHED.every(
      (path) => readFileSync(join(ROOT, path), "utf8") === before.get(path),
    );

    if (!restored) {
      return fail(
        "the scaffold/remove cycle did not restore the touched files",
      );
    }

    if (!verifyScaffoldedTree()) return 1;

    console.log(
      "[scaffold-smoke] passed: scaffold -> verify -> remove -> restore",
    );

    return 0;
  } finally {
    restore(before);
  }
}

process.exitCode = main();
