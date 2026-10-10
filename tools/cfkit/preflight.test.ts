import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  evaluatePreflight,
  isControllerArtifact,
  pathAllowed,
  type PreflightFacts,
} from "./preflight.ts";
import { beginTask, type TaskState } from "./task.ts";

const PLAN_PATH = "docs/exec-plans/active/2026-10-11_sample-task.md";
const REPOSITORY = "identity-1";
const REVISION = "a".repeat(40);

function planSource(overrides: Readonly<Record<string, string>> = {}): string {
  const headers: Record<string, string> = {
    Status: "active",
    Owner: "fikrilal",
    "Task ID": "sample-task",
    Risk: "low",
    "Maximum risk": "low",
    Authority: "edit, verify",
    "Repair limit": "2",
    "Task timeout": "30m",
    Date: "2026-10-11",
    "Impact areas": "Harness/CI: yes",
    "Allowed paths": "tools/cfkit, docs/exec-plans",
    "Allowed actions": "edit, verify",
    ...overrides,
  };

  return `# Sample\n\n${Object.entries(headers)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n")}\n\n## Objective\n\nx\n\n## Verification\n\ny\n`;
}

/**
 * The state and the facts always come from one plan source, so a test can only vary the scenario, never
 * accidentally compare a state built from one plan against facts built from another.
 */
function scenario(
  overrides: Readonly<Record<string, string>> = {},
  preexisting: readonly string[] = [],
): Readonly<{
  state: TaskState;
  facts: (over: Partial<PreflightFacts>) => PreflightFacts;
}> {
  const source = planSource(overrides);
  const root = mkdtempSync(join(tmpdir(), "cfkit-preflight-"));

  try {
    const state = beginTask({
      root,
      planPath: PLAN_PATH,
      planSource: source,
      changedPaths: preexisting,
      repositoryIdentity: REPOSITORY,
      baseRevision: REVISION,
    });

    return {
      state,
      facts: (over) => ({
        planSource: source,
        planPath: PLAN_PATH,
        changedPaths: [],
        repositoryIdentity: REPOSITORY,
        currentRevision: REVISION,
        ...over,
      }),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("preflight: a task inside its authority, scope and risk passes", () => {
  const { state, facts } = scenario({ "Maximum risk": "high" }, ["README.md"]);
  const report = evaluatePreflight(
    state,
    facts({ changedPaths: ["README.md", "tools/cfkit/cli.ts"] }),
    "verify",
  );

  assert.deepEqual(report.problems, []);
  assert.deepEqual(report.taskPaths, ["tools/cfkit/cli.ts"]);
  assert.equal(report.effectiveRisk, "high");
});

test("preflight: the plan must still be there and still declare this task", () => {
  const { state, facts } = scenario();

  assert.deepEqual(
    evaluatePreflight(state, facts({ planSource: undefined }), "verify")
      .problems,
    [`the plan is gone: ${PLAN_PATH}`],
  );

  const wrongId = evaluatePreflight(
    state,
    facts({ planSource: planSource({ "Task ID": "someone-else" }) }),
    "verify",
  ).problems;

  assert.equal(wrongId.length, 1);
  assert.match(wrongId[0] ?? "", /now declares task id "someone-else"/);
});

test("preflight: a changed Authority list breaks the binding", () => {
  const { state, facts } = scenario();
  const problems = evaluatePreflight(
    state,
    facts({ planSource: planSource({ Authority: "edit, verify, commit" }) }),
    "verify",
  ).problems;

  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? "", /Authority changed since the task began/);

  const unbound = evaluatePreflight(
    { ...state, authorityHash: "" },
    facts({}),
    "verify",
  ).problems;

  assert.match(unbound[0] ?? "", /predates the authority binding/);
});

test("preflight: the action must be authorised by the plan", () => {
  const { state, facts } = scenario();
  const problems = evaluatePreflight(state, facts({}), "push").problems;

  assert.deepEqual(problems, [
    'action "push" is not in the plan\'s Allowed actions (edit, verify)',
  ]);
});

test("preflight: only the task's own paths are scoped, and controller artifacts are exempt", () => {
  const { state, facts } = scenario({ "Maximum risk": "high" }, ["src/app.ts"]);
  const report = evaluatePreflight(
    state,
    facts({
      changedPaths: [
        "src/app.ts",
        "tools/cfkit/preflight.ts",
        "src/worker.ts",
        "_WIP/architecture-smells.md",
        ".cfkit/lock.json",
        "docs/exec-plans/completed/2026-10-12_x.md",
      ],
    }),
    "verify",
  );

  assert.deepEqual(report.problems, [
    "paths outside Allowed paths: src/worker.ts",
  ]);
  assert.deepEqual(report.taskPaths, [
    "tools/cfkit/preflight.ts",
    "src/worker.ts",
  ]);
  assert.equal(isControllerArtifact("_WIP/report.md"), true);
  assert.equal(isControllerArtifact(".cfkit/tasks/x/state.json"), true);
  assert.equal(isControllerArtifact("docs/exec-plans/active/x.md"), true);
  assert.equal(isControllerArtifact("src/worker.ts"), false);
});

test("preflight: effective risk may not climb past the plan's maximum", () => {
  const { state, facts } = scenario({
    "Allowed paths": "tools/cfkit, docs/exec-plans, src",
  });
  const report = evaluatePreflight(
    state,
    facts({ changedPaths: ["src/app.ts"] }),
    "verify",
  );

  assert.deepEqual(report.problems, [
    'effective risk "medium" exceeds the plan\'s Maximum risk "low"',
  ]);
  assert.equal(report.effectiveRisk, "medium");
});

test("preflight: repository identity is bound, a moved revision is only a note", () => {
  const { state, facts } = scenario();
  const moved = evaluatePreflight(
    state,
    facts({ currentRevision: "b".repeat(40) }),
    "verify",
  );

  assert.deepEqual(moved.problems, []);
  assert.match(moved.notes[0] ?? "", /revision moved since the task began/);

  const foreign = evaluatePreflight(
    state,
    facts({ repositoryIdentity: "identity-2" }),
    "verify",
  );

  assert.deepEqual(foreign.problems, [
    "this state belongs to a different repository or worktree than the one it began in",
  ]);
});

test("preflight: allowed paths match a directory, never a string prefix", () => {
  assert.equal(pathAllowed("tools/cfkit/cli.ts", ["tools/cfkit"]), true);
  assert.equal(pathAllowed("tools/cfkit", ["tools/cfkit"]), true);
  assert.equal(pathAllowed("tools/cfkit-other/x.ts", ["tools/cfkit"]), false);
  assert.equal(
    pathAllowed("src/app.ts", ["tools/cfkit", "docs/exec-plans"]),
    false,
  );
});
