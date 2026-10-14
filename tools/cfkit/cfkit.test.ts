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

import {
  evaluateDoctor,
  readTaskStateReport,
  type DoctorFacts,
} from "./doctor.ts";
import {
  durationAdvisory,
  PROFILE_DURATION_BUDGETS,
} from "./duration-policy.ts";
import {
  expandProfile,
  resolveProfile,
  VERIFY_PROFILES,
  type VerifyProfile,
  type VerifyProfileName,
} from "./profiles.ts";
import { runProfile, type StepRunner } from "./runner.ts";

const ROOT = join(import.meta.dirname, "..", "..");

test("profiles: fast, full, runtime, and ci compose as documented", () => {
  assert.deepEqual(
    VERIFY_PROFILES.fast.steps.map((step) => step.id),
    [
      "plans:check",
      "format:check",
      "lint",
      "typecheck",
      "typecheck:cfkit",
      "test",
      "test:scripts",
      "budget:check",
      "secrets:check",
      "drift:check",
      "contract:check",
      "contract:lint",
      "config:check",
      "harness:parity",
    ],
  );
  assert.deepEqual(
    VERIFY_PROFILES.full.steps.map((step) => step.id),
    [
      ...VERIFY_PROFILES.fast.steps.map((step) => step.id),
      "test:coverage",
      "duplication:check",
      "duplication:report",
      "build",
      "smells:check",
      "oracles:check",
      "evidence:check",
      "audit:prod",
    ],
  );
  assert.deepEqual(
    VERIFY_PROFILES.gates.steps.map((step) => step.id),
    ["verify:gates"],
  );
  assert.deepEqual(
    VERIFY_PROFILES.runtime.steps.map((step) => step.id),
    ["runtime.smoke"],
  );
  assert.deepEqual(
    VERIFY_PROFILES.smoke.steps.map((step) => step.id),
    ["scaffold.smoke"],
  );
  assert.deepEqual(
    expandProfile("ci").map((step) => step.id),
    [
      ...VERIFY_PROFILES.full.steps.map((step) => step.id),
      "verify:gates",
      "runtime.smoke",
      "scaffold.smoke",
    ],
  );
  assert.equal(resolveProfile("ci")?.name, "ci");
  assert.equal(resolveProfile("nope"), undefined);
});

test("profiles: every step script is a package.json script", () => {
  const parsed: unknown = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  );
  assert.ok(typeof parsed === "object" && parsed !== null);
  const scripts = "scripts" in parsed ? parsed.scripts : undefined;
  assert.ok(typeof scripts === "object" && scripts !== null);

  for (const step of expandProfile("ci")) {
    assert.ok(step.script in scripts, `missing npm script: ${step.script}`);
  }
});

test("profiles: composition cycles are rejected", () => {
  const cyclic: Record<VerifyProfileName, VerifyProfile> = {
    ...VERIFY_PROFILES,
    fast: { name: "fast", steps: [], composes: ["full"] },
    full: { name: "full", steps: [], composes: ["fast"] },
  };

  assert.throws(() => expandProfile("fast", cyclic), /Verify profile cycle/);
});

test("duration policy: budgets are advisory only", () => {
  assert.equal(durationAdvisory("fast", 10_000), undefined);
  assert.equal(durationAdvisory("ci", 10_000), undefined);
  assert.equal(
    durationAdvisory("fast", PROFILE_DURATION_BUDGETS.fast.advisoryMs),
    undefined,
    "the budget itself is not an overrun",
  );
  assert.ok(
    durationAdvisory(
      "fast",
      PROFILE_DURATION_BUDGETS.fast.advisoryMs + 1,
    )?.includes("Duration advisory: fast"),
    "one millisecond past the budget is an overrun",
  );

  const message = durationAdvisory("fast", 999_999);

  assert.ok(message?.includes("Duration advisory: fast"));
  assert.ok(message?.includes("took 999999ms"));
  assert.ok(message?.includes("observed baseline"));
});

test("runner: runs steps in order and stops at the first failure", async () => {
  const calls: string[] = [];
  const outcomes: Record<string, number> = {
    "step-a": 0,
    "step-b": 3,
    "step-c": 0,
  };
  const runner: StepRunner = (script) => {
    calls.push(script);

    return outcomes[script] ?? 1;
  };

  const result = await runProfile(
    {
      name: "fast",
      steps: [
        { id: "step-a", script: "step-a" },
        { id: "step-b", script: "step-b" },
        { id: "step-c", script: "step-c" },
      ],
    },
    runner,
  );

  assert.deepEqual(calls, ["step-a", "step-b"]);
  assert.equal(result.exitCode, 3);
  assert.deepEqual(
    result.results.map((entry) => `${entry.id}:${entry.status}`),
    ["step-a:passed", "step-b:failed"],
  );

  // A failed step carries its taxonomy descriptor; an unmapped id escalates.
  const failed = result.results.at(-1);

  assert.ok(failed !== undefined);
  assert.ok(failed.descriptor !== undefined);
  assert.equal(failed.descriptor.code, "harness.unknown-step");
  assert.equal(failed.descriptor.repairable, false);
});

test("runner: a passing profile returns zero and reports durations", async () => {
  const calls: string[] = [];
  const runner: StepRunner = (script) => {
    calls.push(script);

    return 0;
  };

  const result = await runProfile(
    {
      name: "full",
      steps: [
        { id: "a", script: "a" },
        { id: "b", script: "b" },
      ],
    },
    runner,
  );

  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.results.length, 2);
  assert.ok(result.durationMs >= 0);
  assert.ok(result.results.every((entry) => entry.durationMs >= 0));
  assert.ok(result.results.every((entry) => entry.descriptor === undefined));
});

const GOOD_FACTS: DoctorFacts = {
  nodeVersion: "22.22.0",
  nvmrcVersion: "22.22.0",
  hasNodeModules: true,
  wranglerConfig: '{ "main": "src/worker.ts" }',
  budgetScriptPresent: true,
  migrationsDirPresent: true,
  gitVersion: "git version 2.47.1",
  canonicalRoot: "/repo",
  projectRoot: "/repo",
  privateStateIgnored: true,
  policyProblems: [],
  stateProblems: [],
  staleTasks: [],
  wranglerAvailable: true,
};

test("doctor: golden facts pass every check", () => {
  const checks = evaluateDoctor(GOOD_FACTS);

  assert.equal(
    checks.every((check) => check.status === "ok"),
    true,
  );
});

test("doctor: missing dependencies fail", () => {
  const checks = evaluateDoctor({ ...GOOD_FACTS, hasNodeModules: false });
  const dependencies = checks.find((check) => check.name === "dependencies");

  assert.equal(dependencies?.status, "fail");
});

test("doctor: version mismatch warns", () => {
  const checks = evaluateDoctor({ ...GOOD_FACTS, nvmrcVersion: "20.11.0" });
  const nodeCheck = checks.find((check) => check.name === "node version");

  assert.equal(nodeCheck?.status, "warn");
});

test("doctor: the family checklist is covered, hard failures versus warnings", () => {
  const checks = evaluateDoctor(GOOD_FACTS);

  assert.deepEqual(
    checks.map((check) => check.name),
    [
      "node version",
      "git",
      "canonical root",
      "dependencies",
      "private state ignored",
      "wrangler config",
      "policy schemas",
      "task and workspace state",
      "budget checks",
      "migrations",
      "wrangler toolchain",
      "task recency",
    ],
  );

  // Hard failures: the harness cannot work around any of these.
  const hard: readonly [Partial<DoctorFacts>, string][] = [
    [{ gitVersion: undefined }, "git"],
    [{ canonicalRoot: undefined }, "canonical root"],
    [{ canonicalRoot: "/elsewhere" }, "canonical root"],
    [{ privateStateIgnored: false }, "private state ignored"],
    [{ hasNodeModules: false }, "dependencies"],
    [{ wranglerConfig: undefined }, "wrangler config"],
    [{ policyProblems: ["policy: broken plan"] }, "policy schemas"],
    [{ stateProblems: ["task: unknown phase"] }, "task and workspace state"],
    [{ budgetScriptPresent: false }, "budget checks"],
  ];

  for (const [overrides, name] of hard) {
    const found = evaluateDoctor({ ...GOOD_FACTS, ...overrides }).find(
      (check) => check.name === name,
    );

    assert.equal(found?.status, "fail", `${name} must fail`);
  }

  // Warnings: drift and quiet tasks, not blockers.
  const warn: readonly [Partial<DoctorFacts>, string][] = [
    [{ wranglerAvailable: false }, "wrangler toolchain"],
    [{ staleTasks: ["old-task: verifying for 12 days"] }, "task recency"],
    [{ migrationsDirPresent: false }, "migrations"],
  ];

  for (const [overrides, name] of warn) {
    const found = evaluateDoctor({ ...GOOD_FACTS, ...overrides }).find(
      (check) => check.name === name,
    );

    assert.equal(found?.status, "warn", `${name} must warn`);
  }

  const policy = evaluateDoctor({
    ...GOOD_FACTS,
    policyProblems: ["policy: x", "policy: y"],
  }).find((check) => check.name === "policy schemas");

  assert.match(policy?.detail ?? "", /2 problem\(s\): policy: x/);
});

test("doctor: task and workspace states are read as they are, and quiet tasks warn", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-doctor-"));
  const writeState = (taskId: string, state: unknown): void => {
    mkdirSync(join(root, ".cfkit", "tasks", taskId), { recursive: true });
    writeFileSync(
      join(root, ".cfkit", "tasks", taskId, "state.json"),
      JSON.stringify(state),
    );
  };

  try {
    writeState("fresh", {
      version: 2,
      taskId: "fresh",
      phase: "authorized",
      updatedAt: "2026-10-13T00:00:00.000Z",
    });
    writeState("quiet", {
      version: 2,
      taskId: "quiet",
      phase: "verifying",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    writeState("done", {
      version: 2,
      taskId: "done",
      phase: "handed_off",
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    writeState("stale-schema", {
      version: 1,
      taskId: "stale-schema",
      phase: "active",
      updatedAt: "2026-10-13T00:00:00.000Z",
    });
    writeState("mismatched", {
      version: 2,
      taskId: "someone-else",
      phase: "running",
      updatedAt: "2026-10-13T00:00:00.000Z",
    });
    writeState("unknown-phase", {
      version: 2,
      taskId: "unknown-phase",
      phase: "sleeping",
      updatedAt: "2026-10-13T00:00:00.000Z",
    });
    mkdirSync(join(root, ".cfkit", "tasks", "fresh"), { recursive: true });
    writeFileSync(
      join(root, ".cfkit", "tasks", "fresh", "workspace.json"),
      JSON.stringify({ schemaVersion: 1, taskId: "someone-else" }),
    );

    const report = readTaskStateReport(
      root,
      new Date("2026-10-13T00:00:00.000Z"),
    );

    // Compared sorted: the doctor walks the directory, and the order is not the point.
    assert.deepEqual([...report.problems].sort(), [
      'fresh: workspace.json belongs to "someone-else"',
      'mismatched: state declares task id "someone-else"',
      'stale-schema: unknown phase "active"',
      'unknown-phase: unknown phase "sleeping"',
    ]);
    assert.deepEqual([...report.stale].sort(), [
      "quiet: verifying for 12 days",
      "stale-schema: state schema 1 (migrated on read)",
    ]);

    // An absent .cfkit/ is a normal state, not a problem.
    assert.deepEqual(
      readTaskStateReport(mkdtempSync(join(tmpdir(), "cfkit-empty-"))),
      {
        problems: [],
        stale: [],
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
