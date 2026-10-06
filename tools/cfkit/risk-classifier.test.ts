import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import {
  classifyPath,
  effectiveRisk,
  RISK_RULES,
  runtimeReasons,
  selectLanes,
} from "./risk-classifier.ts";

test("risk rules: every example exists and classifies to its own rule", () => {
  for (const rule of RISK_RULES) {
    if (rule.planned === true) {
      assert.ok(
        (rule.note ?? "").length >= 20,
        `${rule.id} is planned without a note`,
      );
      continue;
    }

    assert.ok(rule.examples.length > 0, `${rule.id} has no example paths`);

    for (const example of rule.examples) {
      assert.ok(
        existsSync(example),
        `${rule.id} example is missing: ${example}`,
      );
      assert.equal(
        classifyPath(example).id,
        rule.id,
        `${rule.id} example is shadowed: ${example} classifies as ${classifyPath(example).id}`,
      );
    }
  }
});

test("risk rules: the table is well formed", () => {
  const ids = RISK_RULES.map((rule) => rule.id);

  assert.equal(new Set(ids).size, ids.length);

  for (const rule of RISK_RULES) {
    assert.match(rule.id, /^(high|medium|low)\.[a-z][a-z0-9-]*$/);
    assert.ok(
      rule.prefixes.length + rule.exact.length + rule.suffixes.length > 0,
      `${rule.id} matches nothing`,
    );
  }
});

test("classifier: representative paths and the unknown default", () => {
  assert.deepEqual(classifyPath("src/platform/auth/guard.ts"), {
    id: "high.auth",
    level: "high",
  });
  assert.deepEqual(classifyPath("db/migrations/0002_x.sql"), {
    id: "high.data",
    level: "high",
  });
  assert.deepEqual(classifyPath("wrangler.jsonc"), {
    id: "high.deploy",
    level: "high",
  });
  assert.deepEqual(classifyPath("tools/cfkit/cli.ts"), {
    id: "high.harness",
    level: "high",
  });
  assert.deepEqual(classifyPath("contracts/backend.openapi.yaml"), {
    id: "high.contract",
    level: "high",
  });
  assert.deepEqual(classifyPath("src/platform/queue/producer.ts"), {
    id: "high.queue",
    level: "high",
  });
  assert.deepEqual(classifyPath("src/jobs.ts"), {
    id: "high.queue",
    level: "high",
  });
  assert.deepEqual(
    classifyPath("src/features/users/profile-image/profile-image.jobs.ts"),
    { id: "high.queue", level: "high" },
  );
  assert.deepEqual(
    classifyPath(
      "src/features/users/account-deletion/account-deletion.jobs.ts",
    ),
    { id: "high.queue", level: "high" },
  );
  assert.deepEqual(classifyPath(".dev.vars"), {
    id: "high.secrets",
    level: "high",
  });
  assert.deepEqual(classifyPath("src/features/auth/auth.routes.ts"), {
    id: "medium.application",
    level: "medium",
  });
  assert.deepEqual(classifyPath("test/x.spec.ts"), {
    id: "medium.tests",
    level: "medium",
  });
  assert.deepEqual(classifyPath("docs/README.md"), {
    id: "low.docs",
    level: "low",
  });
  assert.deepEqual(classifyPath("README.md"), {
    id: "low.root",
    level: "low",
  });
  assert.deepEqual(classifyPath(".github/workflows/ci.yml"), {
    id: "high.ci",
    level: "high",
  });
  // Pinned as a literal: "medium.unknown" is the id the CI annotation and every report carry, so a
  // rename is a policy change, not an implementation detail (the mutation pilot caught exactly that).
  assert.deepEqual(classifyPath("mystery.txt"), {
    id: "medium.unknown",
    level: "medium",
  });
  assert.deepEqual(effectiveRisk("low", ["mystery.txt"]).rules, [
    "medium.unknown",
  ]);
});

test("classifier: effective risk is raise-only", () => {
  assert.deepEqual(effectiveRisk("low", ["docs/x.md"]), {
    risk: "low",
    rules: ["low.docs"],
  });
  assert.equal(effectiveRisk("high", ["docs/x.md"]).risk, "high");
  assert.equal(effectiveRisk("low", ["src/app.ts"]).risk, "medium");
  assert.equal(effectiveRisk("medium", ["contracts/x.yaml"]).risk, "high");

  const mixed = effectiveRisk("low", [
    "docs/x.md",
    "src/app.ts",
    "db/migrations/1.sql",
  ]);

  assert.equal(mixed.risk, "high");
  assert.deepEqual(mixed.rules, [
    "high.data",
    "low.docs",
    "medium.application",
  ]);
});

test("runtime reasons: sorted, unique and table-driven", () => {
  assert.deepEqual(runtimeReasons(["docs/x.md"]), []);
  assert.deepEqual(runtimeReasons(["db/migrations/1.sql", "src/worker.ts"]), [
    "path.database-schema",
    "path.worker",
  ]);
  assert.deepEqual(
    runtimeReasons(["src/features/users/profile-image/profile-image.jobs.ts"]),
    ["path.critical-http", "path.worker"],
  );
  assert.deepEqual(
    runtimeReasons(["src/platform/queue/a.ts", "src/platform/queue/b.ts"]),
    ["path.runtime-platform"],
  );
});

test("lanes: the static lane plus the runtime requirement", () => {
  assert.deepEqual(selectLanes("low", ["docs/x.md"]), {
    lane: "fast",
    runtimeRequired: false,
    reasons: [],
  });
  assert.deepEqual(selectLanes("medium", ["src/platform/logging/logger.ts"]), {
    lane: "full",
    runtimeRequired: false,
    reasons: [],
  });

  const runtime = selectLanes("low", ["wrangler.jsonc"]);

  assert.equal(runtime.lane, "ci");
  assert.equal(runtime.runtimeRequired, true);
  assert.deepEqual(runtime.reasons, ["path.external-adapter"]);
});
