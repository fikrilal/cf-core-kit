import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { classifyPath, effectiveRisk, selectLanes } from "./risk-classifier.ts";
import {
  beginTask,
  declaredRiskFromPlan,
  readTaskState,
  recordFailure,
  recordSuccess,
  taskIdFromPlan,
  writeTaskState,
  type TaskState,
} from "./task.ts";

const PLAN_PATH = "docs/exec-plans/active/2026-10-11_task-lifecycle.md";
const PLAN_SOURCE =
  "# Task lifecycle (task 5.4)\n\n- Status: active\n- Risk: high\n";

test("risk classification maps paths to stable rule ids", () => {
  assert.deepEqual(classifyPath("src/platform/auth/guard.ts"), {
    id: "high.auth",
    level: "high",
  });
  assert.deepEqual(classifyPath("db/migrations/0001_x.sql"), {
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
  assert.deepEqual(classifyPath("src/features/users/me.ts"), {
    id: "medium.application",
    level: "medium",
  });
  assert.deepEqual(classifyPath("test/auth-fixtures.ts"), {
    id: "medium.tests",
    level: "medium",
  });
  assert.deepEqual(classifyPath("scripts/budget/check.mjs"), {
    id: "high.harness",
    level: "high",
  });
  assert.deepEqual(classifyPath("docs/standards/README.md"), {
    id: "low.docs",
    level: "low",
  });
  assert.deepEqual(classifyPath("README.md"), { id: "low.root", level: "low" });
  assert.deepEqual(classifyPath("mystery/file.txt"), {
    id: "medium.unknown",
    level: "medium",
  });
});

test("effective risk may raise the declared risk and never lower it", () => {
  assert.deepEqual(effectiveRisk("low", ["src/features/a.ts"]), {
    risk: "medium",
    rules: ["medium.application"],
  });
  assert.deepEqual(effectiveRisk("medium", ["wrangler.jsonc"]), {
    risk: "high",
    rules: ["high.deploy"],
  });
  assert.deepEqual(effectiveRisk("high", ["docs/x.md"]), {
    risk: "high",
    rules: ["low.docs"],
  });
  assert.deepEqual(effectiveRisk("low", []), { risk: "low", rules: [] });
});

test("lanes follow the risk and runtime-relevant paths", () => {
  assert.equal(selectLanes("low", ["docs/x.md"]).lane, "fast");
  assert.equal(selectLanes("medium", ["tools/cfkit/x.ts"]).lane, "full");
  assert.equal(selectLanes("high", ["tools/cfkit/x.ts"]).lane, "full");
  assert.equal(selectLanes("medium", ["src/features/auth/a.ts"]).lane, "ci");
  assert.equal(selectLanes("high", ["db/migrations/0002.sql"]).lane, "ci");
});

test("task ids derive from plan file names", () => {
  assert.equal(taskIdFromPlan(PLAN_PATH), "task-lifecycle");
  assert.equal(
    taskIdFromPlan("docs/exec-plans/active/2026-10-11_r2-presign.md"),
    "r2-presign",
  );
  assert.throws(
    () => taskIdFromPlan("docs/exec-plans/active/Plan.md"),
    /task id/,
  );
});

test("declared risk comes from the plan header", () => {
  assert.equal(declaredRiskFromPlan(PLAN_SOURCE), "high");
  assert.throws(() => declaredRiskFromPlan("# no header\n"), /Risk:/);
});

test("bounded repair increments, isolates steps, and escalates", () => {
  const base: TaskState = {
    version: 1,
    taskId: "x",
    planPath: PLAN_PATH,
    declaredRisk: "high",
    effectiveRisk: "high",
    rules: [],
    lane: "full",
    repairLimit: 3,
    status: "active",
    attempt: 0,
    failures: [],
    updatedAt: "2026-06-01T00:00:00.000Z",
  };

  let state = recordFailure(base, "lint");
  state = recordFailure(state, "lint");
  state = recordFailure(state, "lint");
  assert.equal(state.status, "active");
  assert.deepEqual(state.failures, [{ stepId: "lint", repeatCount: 3 }]);

  state = recordFailure(state, "typecheck");
  assert.equal(state.status, "active");
  assert.deepEqual(state.failures, [
    { stepId: "lint", repeatCount: 3 },
    { stepId: "typecheck", repeatCount: 1 },
  ]);

  state = recordFailure(state, "lint");
  assert.equal(state.status, "escalated");
  assert.deepEqual(state.failures, [
    { stepId: "lint", repeatCount: 4 },
    { stepId: "typecheck", repeatCount: 1 },
  ]);

  const verified = recordSuccess(state);
  assert.equal(verified.status, "verified");
  assert.deepEqual(verified.failures, []);
  assert.equal(verified.attempt, state.attempt + 1);
});

test("task state persists under .cfkit and refuses duplicates", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-task-"));

  try {
    const state = beginTask({
      root,
      planPath: PLAN_PATH,
      planSource: PLAN_SOURCE,
      changedPaths: ["tools/cfkit/task.ts", "docs/exec-plans/active/x.md"],
    });

    assert.equal(state.taskId, "task-lifecycle");
    assert.equal(state.effectiveRisk, "high");
    assert.equal(state.lane, "full");
    assert.deepEqual(state.rules, ["high.harness", "low.docs"]);

    const relative = writeTaskState(root, state);
    assert.equal(relative, ".cfkit/tasks/task-lifecycle/state.json");
    assert.deepEqual(readTaskState(root, state.taskId), state);

    assert.throws(
      () =>
        beginTask({
          root,
          planPath: PLAN_PATH,
          planSource: PLAN_SOURCE,
          changedPaths: [],
        }),
      /already tracked/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
