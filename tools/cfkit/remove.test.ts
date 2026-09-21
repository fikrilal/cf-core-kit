import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { repoAccess } from "./commands-remove.ts";
import { applyRemovePlan } from "./remove-apply.ts";
import { buildEndpointRemoval, buildFeatureRemoval } from "./remove.ts";
import { applyScaffoldPlan } from "./scaffold-apply.ts";
import { buildEndpointScaffold } from "./scaffold-endpoint.ts";
import { buildFeatureScaffold, type RepoAccess } from "./scaffold.ts";

const ROOT = process.cwd();
const OPERATION = "users.me.pushToken.revoke";
const SEEDED_PATHS = [
  "src/app.ts",
  "tools/contract/emit.entry.ts",
  "tools/parity/coverage.json",
  "eslint.config.mjs",
];

function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function repoAccessFor(root: string, features: readonly string[]): RepoAccess {
  const access = repoAccess(root);

  return { ...access, featureNames: () => features };
}

function pendingCoverage(operation: string): Record<string, unknown> {
  const coverage = JSON.parse(readRepoFile("tools/parity/coverage.json")) as {
    pending: string[];
    implemented: string[];
  };

  return {
    ...coverage,
    pending: [
      ...coverage.pending.filter((entry) => entry !== operation),
      operation,
    ].sort(),
    implemented: coverage.implemented.filter((entry) => entry !== operation),
  };
}

function seedWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "cfkit-remove-"));

  for (const path of SEEDED_PATHS) {
    mkdirSync(join(workspace, path, ".."), { recursive: true });
    writeFileSync(join(workspace, path), readRepoFile(path));
  }

  writeFileSync(
    join(workspace, "tools/parity/coverage.json"),
    `${JSON.stringify(pendingCoverage(OPERATION), null, 2)}\n`,
  );
  mkdirSync(join(workspace, "src/features/users"), { recursive: true });
  mkdirSync(join(workspace, "src/features/auth"), { recursive: true });

  return workspace;
}

function scaffoldEndpointInto(workspace: string): void {
  applyScaffoldPlan(
    workspace,
    buildEndpointScaffold({
      operationId: OPERATION,
      snapshotYaml: readRepoFile("contracts/backend.openapi.yaml"),
      coverageJson: readFileSync(
        join(workspace, "tools/parity/coverage.json"),
        "utf8",
      ),
      appSource: readRepoFile("src/app.ts"),
      emitterSource: readRepoFile("tools/contract/emit.entry.ts"),
      knownErrorCodes: new Set(
        [
          ...readRepoFile("src/shared/error-codes.ts").matchAll(
            /^\s*([A-Z][A-Z0-9_]+) = /gm,
          ),
        ].map((match) => match[1] ?? ""),
      ),
      knownTags: new Set(["Auth", "Users"]),
      featureExists: (feature) => feature === "users",
    }),
  );
}

test("endpoint removal restores every seed byte-for-byte", () => {
  const workspace = seedWorkspace();
  const originals = new Map(
    SEEDED_PATHS.map((path) => [
      path,
      readFileSync(join(workspace, path), "utf8"),
    ]),
  );

  try {
    const scaffolded = scaffoldEndpointInto;

    assert.throws(
      () =>
        buildEndpointRemoval({
          operationId: OPERATION,
          repo: repoAccessFor(workspace, ["users", "auth"]),
        }),
      /not implemented/,
    );

    scaffolded(workspace);

    assert.ok(
      existsSync(
        join(workspace, "src/features/users/me-push-token-revoke.routes.ts"),
      ),
    );

    applyRemovePlan(
      workspace,
      buildEndpointRemoval({
        operationId: OPERATION,
        repo: repoAccessFor(workspace, ["users", "auth"]),
      }),
    );

    for (const [path, original] of originals) {
      assert.equal(
        readFileSync(join(workspace, path), "utf8"),
        original,
        `${path} must be restored byte-for-byte`,
      );
    }

    assert.ok(
      !existsSync(
        join(workspace, "src/features/users/me-push-token-revoke.routes.ts"),
      ),
    );
    assert.ok(
      !existsSync(
        join(
          workspace,
          "src/features/users/me-push-token-revoke.routes.spec.ts",
        ),
      ),
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("endpoint removal refuses hand-written routes without the marker", () => {
  const workspace = seedWorkspace();

  try {
    scaffoldEndpointInto(workspace);
    writeFileSync(
      join(workspace, "src/features/users/me-push-token-revoke.routes.ts"),
      "// hand written, marker stripped\n",
    );

    assert.throws(
      () =>
        buildEndpointRemoval({
          operationId: OPERATION,
          repo: repoAccessFor(workspace, ["users", "auth"]),
        }),
      /hand-written route/,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("feature removal round-trips the zone wiring byte-for-byte", () => {
  const workspace = seedWorkspace();
  const eslintBefore = readRepoFile("eslint.config.mjs");
  const coverageBefore = readFileSync(
    join(workspace, "tools/parity/coverage.json"),
    "utf8",
  );

  try {
    applyScaffoldPlan(
      workspace,
      buildFeatureScaffold("billing", {
        exists: () => false,
        existingFeatures: () => ["auth", "users"],
      }),
    );

    assert.ok(existsSync(join(workspace, "src/features/billing/service.ts")));
    assert.notEqual(
      readFileSync(join(workspace, "eslint.config.mjs"), "utf8"),
      eslintBefore,
    );

    applyRemovePlan(
      workspace,
      buildFeatureRemoval({
        rawName: "billing",
        repo: repoAccessFor(workspace, ["auth", "users", "billing"]),
        forceCore: false,
        force: false,
      }),
    );

    assert.equal(
      readFileSync(join(workspace, "eslint.config.mjs"), "utf8"),
      eslintBefore,
      "eslint.config.mjs must be restored byte-for-byte",
    );
    assert.equal(
      readFileSync(join(workspace, "tools/parity/coverage.json"), "utf8"),
      coverageBefore,
    );
    assert.ok(!existsSync(join(workspace, "src/features/billing")));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("feature removal refuses protected, unknown, and hand-edited features", () => {
  const workspace = seedWorkspace();

  try {
    assert.throws(
      () =>
        buildFeatureRemoval({
          rawName: "auth",
          repo: repoAccessFor(workspace, ["auth", "users"]),
          forceCore: false,
          force: false,
        }),
      /protected core feature/,
    );

    assert.throws(
      () =>
        buildFeatureRemoval({
          rawName: "nope",
          repo: repoAccessFor(workspace, ["auth", "users"]),
          forceCore: false,
          force: false,
        }),
      /does not exist/,
    );

    mkdirSync(join(workspace, "src/features/billing"), { recursive: true });
    writeFileSync(
      join(workspace, "src/features/billing/hand-rolled.ts"),
      "export const handRolled = true;\n",
    );

    assert.throws(
      () =>
        buildFeatureRemoval({
          rawName: "billing",
          repo: repoAccessFor(workspace, ["auth", "users", "billing"]),
          forceCore: false,
          force: false,
        }),
      /were not scaffolded/,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
