import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { classifyPath, effectiveRisk, selectLanes } from "./risk-classifier.ts";
import {
  beginTask,
  recordFailure,
  recordSuccess,
  transition,
  TRANSITIONS,
} from "./task.ts";
import {
  declaredRiskFromPlan,
  failureFingerprint,
  isTerminal,
  migrateState,
  parseTimeoutSeconds,
  readTaskState,
  taskIdFromPlan,
  TASK_PHASES,
  writeTaskState,
  type TaskState,
} from "./task-state.ts";

const PLAN_PATH = "docs/exec-plans/active/2026-10-11_task-lifecycle.md";
const PLAN_SOURCE = `# Task lifecycle

- Status: active
- Owner: fikrilal
- Task ID: task-lifecycle
- Risk: high
- Maximum risk: high
- Authority: edit, verify
- Repair limit: 3
- Task timeout: 90m
- Date: 2026-10-11
- Related ADRs / proposals: none
- Impact areas: Harness/CI: yes
- Allowed paths: tools/cfkit, docs/exec-plans
- Allowed actions: edit, verify, commit
`;

const GIT_FACTS = {
  repositoryIdentity: "identity-1",
  baseRevision: "a".repeat(40),
};

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

test("the machine starts authorized and records what the plan authorised", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-task-"));

  try {
    const state = beginTask({
      root,
      planPath: PLAN_PATH,
      planSource: PLAN_SOURCE,
      changedPaths: ["tools/cfkit/task.ts", "docs/exec-plans/active/x.md"],
      ...GIT_FACTS,
    });

    assert.equal(state.taskId, "task-lifecycle");
    assert.equal(state.phase, "authorized");
    assert.equal(state.authorityHash !== "", true);
    assert.deepEqual(state.authority, ["edit", "verify"]);
    assert.deepEqual(state.allowedPaths, ["tools/cfkit", "docs/exec-plans"]);
    assert.deepEqual(state.allowedActions, ["edit", "verify", "commit"]);
    assert.equal(state.maximumRisk, "high");
    assert.equal(state.repairLimit, 3);
    assert.equal(state.taskTimeoutSeconds, 90 * 60);
    assert.deepEqual(state.preexistingPaths, [
      "docs/exec-plans/active/x.md",
      "tools/cfkit/task.ts",
    ]);
    assert.equal(state.history.length, 1);
    assert.equal(state.history[0]?.to, "authorized");
    assert.equal(state.effectiveRisk, "high");
    assert.equal(state.lane, "full");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every phase is reachable only through its legal transitions", () => {
  const state = beginTask({
    root: mkdtempSync(join(tmpdir(), "cfkit-task-")),
    planPath: PLAN_PATH,
    planSource: PLAN_SOURCE,
    changedPaths: [],
    ...GIT_FACTS,
  });

  assert.throws(
    () => transition(state, "ready_for_review"),
    /illegal task transition/,
  );
  assert.throws(
    () => transition(state, "handed_off"),
    /illegal task transition/,
  );

  const running = transition(transition(state, "preparing"), "running");
  const verifying = transition(running, "verifying");
  const reviewing = transition(verifying, "ready_for_review");
  const handedOff = transition(reviewing, "handed_off", {
    reason: "commit applied",
  });

  assert.equal(handedOff.phase, "handed_off");
  assert.equal(isTerminal(handedOff.phase), true);
  assert.throws(
    () => transition(handedOff, "running"),
    /illegal task transition/,
  );
  assert.deepEqual(
    handedOff.history.map((entry) => entry.to),
    [
      "authorized",
      "preparing",
      "running",
      "verifying",
      "ready_for_review",
      "handed_off",
    ],
  );

  // The table and the state list agree: every phase is known, and every key is a phase.
  assert.deepEqual(Object.keys(TRANSITIONS).sort(), [...TASK_PHASES].sort());
});

test("repair counts by failure fingerprint and escalates at the plan's limit", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-task-"));

  try {
    const base = transition(
      transition(
        beginTask({
          root,
          planPath: PLAN_PATH,
          planSource: PLAN_SOURCE,
          changedPaths: [],
          ...GIT_FACTS,
        }),
        "preparing",
      ),
      "running",
    );
    const verifying = transition(base, "verifying");
    let state = recordFailure(verifying, {
      stepId: "lint",
      code: "verify.lint",
    });

    // A second failure on the same step with a different code is a different fingerprint.
    state = recordFailure(state, { stepId: "lint", code: "verify.scripts" });
    assert.equal(state.failures.length, 2);
    assert.equal(state.failures[0]?.repeatCount, 1);
    assert.equal(state.failures[1]?.repeatCount, 1);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      state = recordFailure(state, { stepId: "lint", code: "verify.lint" });
    }

    assert.equal(state.phase, "verifying");
    assert.equal(state.failures[0]?.repeatCount, 3);

    // The fourth repeat crosses the plan's limit of 3.
    state = recordFailure(state, { stepId: "lint", code: "verify.lint" });
    assert.equal(state.phase, "escalated");
    assert.equal(state.stopReason, "task.repair-limit");
    assert.match(state.history.at(-1)?.reason ?? "", /repair limit reached/);
    assert.equal(
      state.failures[0]?.fingerprint,
      failureFingerprint({ stepId: "lint", code: "verify.lint" }),
    );

    const verified = recordSuccess(state);
    assert.deepEqual(verified.failures, []);
    assert.equal(verified.attempt, state.attempt + 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("timeouts parse from the plan and fall back to 90 minutes", () => {
  assert.equal(parseTimeoutSeconds("30m"), 1_800);
  assert.equal(parseTimeoutSeconds("2h"), 7_200);
  assert.equal(parseTimeoutSeconds("45s"), 45);
  assert.equal(parseTimeoutSeconds(undefined), 90 * 60);
  assert.equal(parseTimeoutSeconds("nonsense"), 90 * 60);
});

test("a schema 1 state is migrated on read, and says so in its history", () => {
  const migrated = migrateState(
    {
      version: 1,
      taskId: "old-task",
      planPath: PLAN_PATH,
      declaredRisk: "medium",
      effectiveRisk: "high",
      rules: ["high.harness"],
      lane: "full",
      repairLimit: 3,
      status: "verified",
      attempt: 2,
      failures: [],
      updatedAt: "2026-06-01T00:00:00.000Z",
    },
    new Date("2026-10-13T00:00:00.000Z"),
  ) as TaskState;

  assert.equal(migrated.version, 2);
  assert.equal(migrated.phase, "ready_for_review");
  assert.equal(migrated.maximumRisk, "medium");
  assert.equal(migrated.authorityHash, "");
  assert.equal(migrated.history[0]?.reason, "migrated from schema 1");

  const fromAuthorized = migrateState(
    { version: 1, status: "active", declaredRisk: "low" },
    new Date("2026-10-13T00:00:00.000Z"),
  ) as TaskState;

  assert.equal(fromAuthorized.phase, "authorized");
});

test("task state persists under .cfkit and refuses duplicates", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-task-"));

  try {
    const state = beginTask({
      root,
      planPath: PLAN_PATH,
      planSource: PLAN_SOURCE,
      changedPaths: ["tools/cfkit/task.ts"],
      ...GIT_FACTS,
    });

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
          ...GIT_FACTS,
        }),
      /already tracked/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
