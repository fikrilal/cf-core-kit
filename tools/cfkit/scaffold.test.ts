import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildFeatureScaffold,
  normalizeFeatureName,
  operationSlug,
} from "./scaffold.ts";

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

test("feature scaffold: the clean tier emits the ADR-0001 shape", () => {
  const plan = buildFeatureScaffold("billing", {
    exists: () => false,
    tier: "clean",
  });

  assert.match(plan.description, /\(clean\)/);
  assert.deepEqual(
    plan.files.map((file) => file.path),
    [
      "src/features/billing/billing.routes.ts",
      "src/features/billing/billing.operations.ts",
      "src/features/billing/index.ts",
    ],
  );

  const routes = plan.files[0]?.content ?? "";

  assert.match(routes, /export function registerBillingRoutes/);
  assert.match(routes, /\/\/ cfkit:capabilities/);

  const operations = plan.files[1]?.content ?? "";

  assert.match(operations, /export const billingOperations = \[\] as const;/);
  assert.match(plan.files[2]?.content ?? "", /from "\.\/billing\.routes"/);
});

test("feature scaffold: --with-queue adds the job module and its registry import", () => {
  const plan = buildFeatureScaffold("billing", {
    exists: () => false,
    withQueue: true,
  });

  assert.match(plan.description, /with queue/);
  assert.ok(
    plan.files.some(
      (file) => file.path === "src/features/billing/billing.jobs.ts",
    ),
  );

  const jobs = plan.files.find((file) => file.path.endsWith(".jobs.ts"));
  const content = jobs?.content ?? "";

  assert.match(content, /defineJob/);
  assert.match(content, /name: "billing\.probe"/);
  assert.match(content, /export function createBillingJobs/);

  // Two edits: the import lands at the anchor and the factory is spread into the registry, so the job module
  // can be neither orphaned (the smell rule checks the import) nor unused (lint checks the composition).
  assert.deepEqual(plan.edits.slice(-2), [
    {
      path: "src/jobs.ts",
      anchor: "// cfkit:job-factories",
      placement: "line-after",
      lines: [
        'import { createBillingJobs } from "./features/billing/billing.jobs";',
      ],
    },
    {
      path: "src/jobs.ts",
      anchor: "createJobRegistry([",
      placement: "line-after",
      lines: ["      ...createBillingJobs(),"],
    },
  ]);
});

test("feature scaffold: an unknown tier and a force-less collision are refused", () => {
  assert.throws(
    () =>
      buildFeatureScaffold("billing", {
        exists: () => false,
        tier: "fancy" as never,
      }),
    /Unknown tier "fancy"/,
  );

  assert.throws(
    () => buildFeatureScaffold("billing", { exists: () => true }),
    /already exists: src\/features\/billing \(pass --force/,
  );

  assert.ok(
    buildFeatureScaffold("billing", { exists: () => true, force: true }).files
      .length > 0,
  );
});
