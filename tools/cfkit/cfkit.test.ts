import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { evaluateDoctor, type DoctorFacts } from "./doctor.ts";
import { resolveProfile, VERIFY_PROFILES } from "./profiles.ts";
import { runProfile, type StepRunner } from "./runner.ts";

const ROOT = join(import.meta.dirname, "..", "..");

test("profiles: fast and full compose as documented", () => {
  assert.deepEqual(VERIFY_PROFILES.fast.steps, [
    "format:check",
    "lint",
    "typecheck",
    "typecheck:cfkit",
    "test",
    "test:scripts",
    "budget:check",
    "drift:check",
    "contract:check",
    "contract:lint",
  ]);
  assert.deepEqual(VERIFY_PROFILES.full.steps, [
    ...VERIFY_PROFILES.fast.steps,
    "build",
  ]);
  assert.equal(resolveProfile("fast")?.name, "fast");
  assert.equal(resolveProfile("nope"), undefined);
});

test("profiles: every step id is a package.json script", () => {
  const parsed: unknown = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  );
  assert.ok(typeof parsed === "object" && parsed !== null);
  const scripts = "scripts" in parsed ? parsed.scripts : undefined;
  assert.ok(typeof scripts === "object" && scripts !== null);

  for (const step of VERIFY_PROFILES.full.steps) {
    assert.ok(step in scripts, `missing npm script: ${step}`);
  }
});

test("runner: runs steps in order and stops at the first failure", () => {
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

  const result = runProfile(
    { name: "fast", steps: ["step-a", "step-b", "step-c"] },
    runner,
  );

  assert.deepEqual(calls, ["step-a", "step-b"]);
  assert.equal(result.exitCode, 3);
  assert.deepEqual(
    result.results.map((entry) => `${entry.id}:${entry.status}`),
    ["step-a:passed", "step-b:failed"],
  );
});

test("runner: a passing profile returns zero", () => {
  const calls: string[] = [];
  const runner: StepRunner = (script) => {
    calls.push(script);

    return 0;
  };

  const result = runProfile({ name: "full", steps: ["a", "b"] }, runner);

  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.results.length, 2);
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
