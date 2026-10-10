import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { evaluateDoctor, type DoctorFacts } from "./doctor.ts";
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
