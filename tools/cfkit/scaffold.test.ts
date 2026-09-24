import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { applyScaffoldPlan } from "./scaffold-apply.ts";
import { buildEndpointScaffold, findOperation } from "./scaffold-endpoint.ts";
import {
  buildFeatureScaffold,
  GENERATED_MARKER,
  normalizeFeatureName,
  operationSlug,
} from "./scaffold.ts";

const ROOT = process.cwd();

function readRepoFile(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function repoErrorCodes(): ReadonlySet<string> {
  const source = readRepoFile("src/shared/error-codes.ts");
  const codes = [...source.matchAll(/^\s*([A-Z][A-Z0-9_]+) = /gm)].map(
    (match) => match[1] ?? "",
  );

  return new Set(codes);
}

function pendingCoverage(operationId: string): string {
  const parsed = JSON.parse(readRepoFile("tools/parity/coverage.json")) as {
    pending: string[];
    implemented: string[];
    [key: string]: unknown;
  };

  return JSON.stringify({
    ...parsed,
    pending: [
      ...parsed.pending.filter((entry) => entry !== operationId),
      operationId,
    ],
    implemented: parsed.implemented.filter((entry) => entry !== operationId),
  });
}

function endpointInput(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "users.me.pushToken.revoke",
    snapshotYaml: readRepoFile("contracts/backend.openapi.yaml"),
    coverageJson: pendingCoverage("users.me.pushToken.revoke"),
    appSource: readRepoFile("src/app.ts"),
    emitterSource: readRepoFile("tools/contract/emit.entry.ts"),
    knownErrorCodes: repoErrorCodes(),
    knownTags: new Set(["Auth", "Users"]),
    featureExists: () => true,
    ...overrides,
  };
}

test("feature names normalize to kebab-case or throw", () => {
  assert.equal(normalizeFeatureName("Billing"), "billing");
  assert.equal(normalizeFeatureName("order_history"), "order-history");
  assert.equal(normalizeFeatureName(" order history "), "order-history");
  assert.equal(normalizeFeatureName("user_billing"), "user-billing");

  for (const invalid of ["", "   ", "2fa", "---", "_"]) {
    assert.throws(() => normalizeFeatureName(invalid), /kebab-case/);
  }
});

test("operation ids map to slugs and features", () => {
  assert.equal(operationSlug("me.pushToken.upsert"), "me-push-token-upsert");
});

test("feature scaffold plans three files and refuses existing directories", () => {
  const plan = buildFeatureScaffold("billing", {
    exists: () => false,
    existingFeatures: () => ["auth", "users"],
  });

  assert.deepEqual(
    plan.files.map((file) => file.path),
    [
      "src/features/billing/service.ts",
      "src/features/billing/service.spec.ts",
      "src/features/billing/index.ts",
    ],
  );
  assert.match(plan.files[0]?.content ?? "", /export function describeFeature/);
  const [zoneEdit] = plan.edits;

  assert.ok(zoneEdit !== undefined);
  assert.equal(zoneEdit.path, "eslint.config.mjs");
  assert.ok(
    zoneEdit.lines.some((line) =>
      line.includes('target: "./features/billing"'),
    ),
  );

  assert.throws(
    () => buildFeatureScaffold("billing", { exists: () => true }),
    /already exists/,
  );
});

test("feature scaffold wires every cross-feature zone pair", () => {
  const plan = buildFeatureScaffold("billing", {
    exists: () => false,
    existingFeatures: () => ["auth", "users"],
  });
  const [zoneEdit] = plan.edits;

  assert.ok(zoneEdit !== undefined);
  assert.equal(zoneEdit.anchor, "zones: [");
  assert.equal(zoneEdit.lines.length, 28);

  const target = (feature: string) =>
    zoneEdit.lines.filter(
      (line) => line.trim() === `target: "./features/${feature}",`,
    ).length;

  assert.equal(target("billing"), 2);
  assert.equal(target("auth"), 1);
  assert.equal(target("users"), 1);
});

test("endpoint scaffold plans a pending simple 204 operation", () => {
  const plan = buildEndpointScaffold(endpointInput());

  const [routes] = plan.files;

  assert.ok(routes !== undefined);
  assert.equal(plan.kind, "endpoint");
  assert.equal(plan.moveOperation, "users.me.pushToken.revoke");
  assert.equal(
    routes.path,
    "src/features/users/me-push-token-revoke.routes.ts",
  );
  assert.deepEqual(
    plan.edits.map((edit) => edit.path),
    [
      "src/app.ts",
      "src/app.ts",
      "tools/contract/emit.entry.ts",
      "tools/contract/emit.entry.ts",
      "tools/contract/emit.entry.ts",
    ],
  );
});

test("endpoint scaffold content carries the pinned operation and markers", () => {
  const plan = buildEndpointScaffold(endpointInput());
  const [routesFile, specFile] = plan.files;

  assert.ok(routesFile !== undefined);
  assert.ok(specFile !== undefined);

  const routes = routesFile.content;
  const spec = specFile.content;

  assert.ok(routes.includes(GENERATED_MARKER));
  assert.match(routes, /method: "delete"/);
  assert.match(routes, /path: "\/v1\/me\/push-token"/);
  assert.match(routes, /operationId: "users\.me\.pushToken\.revoke"/);
  assert.match(routes, /requireAuth/);
  assert.match(routes, /ErrorCode\.UNAUTHORIZED/);

  assert.match(spec, /registerMePushTokenRevokeRoutes/);
  assert.match(spec, /expect\(response\.status\)\.toBe\(401\)/);
});

test("endpoint scaffold handles public operations without auth wiring", () => {
  const snapshotYaml = [
    "paths:",
    "  /v1/auth/example/confirm:",
    "    post:",
    "      operationId: auth.example.confirm",
    "      tags:",
    "        - Auth",
    '      summary: "Confirm an example"',
    '      description: "Public confirmation."',
    "      parameters: []",
    "      responses:",
    '        "204":',
    '          description: ""',
    "      x-error-codes:",
    "        - VALIDATION_FAILED",
    "        - INTERNAL",
  ].join("\n");
  const plan = buildEndpointScaffold(
    endpointInput({
      operationId: "auth.example.confirm",
      snapshotYaml,
      coverageJson: JSON.stringify({
        pending: ["auth.example.confirm"],
        implemented: [],
      }),
    }),
  );
  const [routesFile] = plan.files;

  assert.ok(routesFile !== undefined);

  const routes = routesFile.content;

  assert.doesNotMatch(routes, /requireAuth/);
  assert.doesNotMatch(routes, /security:/);
  assert.match(routes, /method: "post"/);
});

test("endpoint scaffold refuses unsupported operations with reasons", () => {
  assert.throws(
    () =>
      buildEndpointScaffold(
        endpointInput({ operationId: "auth.nope.missing" }),
      ),
    /not in the pinned snapshot/,
  );
  assert.throws(
    () =>
      buildEndpointScaffold(
        endpointInput({
          operationId: "auth.oidc.exchange",
          coverageJson: JSON.stringify({
            pending: ["users.me.pushToken.revoke"],
            implemented: ["auth.oidc.exchange"],
          }),
        }),
      ),
    /not pending in coverage\.json/,
  );
  assert.throws(
    () =>
      buildEndpointScaffold(
        endpointInput({
          operationId: "users.me.profileImage.upload",
          coverageJson: JSON.stringify({
            pending: ["users.me.profileImage.upload"],
            implemented: ["auth.oidc.exchange"],
          }),
        }),
      ),
    /not a simple 204 operation/,
  );
  assert.throws(
    () =>
      buildEndpointScaffold(
        endpointInput({
          knownErrorCodes: new Set(["VALIDATION_FAILED", "INTERNAL"]),
        }),
      ),
    /Missing error codes/,
  );
  assert.throws(
    () =>
      buildEndpointScaffold(
        endpointInput({
          operationId: "admin.users.list",
          featureExists: () => false,
        }),
      ),
    /scaffold feature admin/,
  );
  assert.throws(
    () =>
      buildEndpointScaffold(
        endpointInput({
          appSource: readRepoFile("src/app.ts").replace(
            "registerUsersRoutes(app);",
            "registerOther(app);",
          ),
        }),
      ),
    /app\.ts/,
  );
});

test("apply writes files, edits, and the manifest move in one pass", () => {
  const workspace = mkdtempSync(join(tmpdir(), "cfkit-scaffold-"));

  try {
    const paths = [
      "src/app.ts",
      "tools/contract/emit.entry.ts",
      "tools/parity/coverage.json",
    ];

    for (const path of paths) {
      mkdirSync(join(workspace, path, ".."), { recursive: true });
      writeFileSync(
        join(workspace, path),
        path === "tools/parity/coverage.json"
          ? pendingCoverage("users.me.pushToken.revoke")
          : readRepoFile(path),
      );
    }
    mkdirSync(join(workspace, "src/features/users"), { recursive: true });

    const plan = buildEndpointScaffold(endpointInput());
    const touched = applyScaffoldPlan(workspace, plan);

    assert.ok(
      touched.includes("src/features/users/me-push-token-revoke.routes.ts"),
    );

    const routes = readFileSync(
      join(workspace, "src/features/users/me-push-token-revoke.routes.ts"),
      "utf8",
    );
    assert.match(routes, /registerMePushTokenRevokeRoutes/);

    const app = readFileSync(join(workspace, "src/app.ts"), "utf8");
    assert.match(app, /import \{ registerMePushTokenRevokeRoutes \}/);
    assert.match(app, /registerMePushTokenRevokeRoutes\(app\);/);

    const emitter = readFileSync(
      join(workspace, "tools/contract/emit.entry.ts"),
      "utf8",
    );
    assert.match(emitter, /registerMePushTokenRevokeRoutes/);
    assert.match(emitter, /\.\.\.mePushTokenRevokeOperations,/);
    assert.ok(
      emitter.includes(
        '} from "../../src/features/users/users.routes";\nimport { registerMePushTokenRevokeRoutes',
      ),
      "the scaffolded import must land after the complete users.routes statement",
    );

    const coverage = JSON.parse(
      readFileSync(join(workspace, "tools/parity/coverage.json"), "utf8"),
    ) as {
      source?: unknown;
      pending: string[];
      implemented: string[];
    };
    assert.ok(coverage.implemented.includes("users.me.pushToken.revoke"));
    assert.ok(!coverage.pending.includes("users.me.pushToken.revoke"));
    assert.ok(
      coverage.source !== undefined,
      "the manifest provenance block must survive the move",
    );

    assert.throws(() => applyScaffoldPlan(workspace, plan), /already exists/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("apply refuses before writing when an anchor is missing", () => {
  const workspace = mkdtempSync(join(tmpdir(), "cfkit-scaffold-"));

  try {
    writeFileSync(join(workspace, "app.ts"), "// no anchors here\n");

    const plan = buildEndpointScaffold(endpointInput());
    // Point the plan at a workspace whose app.ts lacks the anchors by removing
    // the anchored lines from the copied sources.
    const paths = [
      "tools/contract/emit.entry.ts",
      "tools/parity/coverage.json",
    ];

    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(join(workspace, "src/app.ts"), "// no anchors here\n");
    for (const path of paths) {
      mkdirSync(join(workspace, path, ".."), { recursive: true });
      writeFileSync(join(workspace, path), readRepoFile(path));
    }

    assert.throws(() => applyScaffoldPlan(workspace, plan), /app\.ts/);
    assert.equal(
      readFileSync(join(workspace, "src/app.ts"), "utf8"),
      "// no anchors here\n",
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("findOperation exposes the pinned shape", () => {
  const operation = findOperation(
    readRepoFile("contracts/backend.openapi.yaml"),
    "users.me.pushToken.revoke",
  );

  assert.equal(operation.method, "delete");
  assert.equal(operation.path, "/v1/me/push-token");
  assert.equal(operation.tag, "Users");
  assert.equal(operation.secured, true);
  assert.deepEqual(operation.responseStatuses, ["204"]);
  assert.equal(operation.hasRequestBody, false);
});
