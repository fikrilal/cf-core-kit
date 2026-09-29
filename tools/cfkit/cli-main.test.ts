import assert from "node:assert/strict";
import { test } from "node:test";

import { main } from "./cli-main.ts";

type Captured = Readonly<{ code: number; out: string; err: string }>;

async function run(args: readonly string[]): Promise<Captured> {
  const out: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  console.log = ((...values: unknown[]): void => {
    out.push(values.join(" "));
  }) as typeof console.log;
  console.error = ((...values: unknown[]): void => {
    errors.push(values.join(" "));
  }) as typeof console.error;

  try {
    const code = await main(args);

    return { code, out: out.join("\n"), err: errors.join("\n") };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test("cli: help exits 0 and prints the usage with exit codes", async () => {
  const result = await run(["--help"]);

  assert.equal(result.code, 0);
  assert.ok(result.out.includes("cfkit <command>"));
  assert.ok(
    result.out.includes("Exit codes: 0 success, 1 error, 2 usage error."),
  );
});

test("cli: no command is a usage error", async () => {
  const result = await run([]);

  assert.equal(result.code, 2);
  assert.ok(result.err.includes("cfkit <command>"));
});

test("cli: unknown command is a usage error with a hint", async () => {
  const result = await run(["nope"]);

  assert.equal(result.code, 2);
  assert.ok(result.err.includes('unknown command "nope"'));
  assert.ok(result.err.includes("--help"));
});

test("cli: unknown flags and missing values are usage errors", async () => {
  const unknownFlag = await run(["verify", "--wat"]);
  const missingValue = await run(["verify", "--profile"]);

  assert.equal(unknownFlag.code, 2);
  assert.ok(unknownFlag.err.includes('unknown flag "--wat"'));
  assert.equal(missingValue.code, 2);
  assert.ok(missingValue.err.includes('flag "--profile" needs a value'));
});

test("cli: an unknown profile is a usage error", async () => {
  const result = await run(["verify", "--profile", "nope"]);

  assert.equal(result.code, 2);
  assert.ok(result.err.includes('unknown profile "nope"'));
});

test("cli: task and handoff usage errors surface as 2", async () => {
  const begin = await run(["task", "begin"]);
  const verify = await run(["task", "verify"]);
  const status = await run(["task", "status"]);
  const subcommand = await run(["task", "wat"]);
  const commit = await run([
    "handoff",
    "commit",
    "--task",
    "t",
    "--challenge",
    "c",
  ]);
  const merge = await run([
    "handoff",
    "merge",
    "--task",
    "x",
    "--challenge",
    "y",
  ]);

  assert.equal(begin.code, 2);
  assert.ok(begin.err.includes('missing required flag "--plan"'));
  assert.equal(verify.code, 2);
  assert.ok(verify.err.includes('missing required flag "--task"'));
  assert.equal(status.code, 2);
  assert.ok(status.err.includes('missing required flag "--task"'));
  assert.equal(commit.code, 2);
  assert.ok(commit.err.includes('missing required flag "--message"'));
  assert.equal(subcommand.code, 2);
  assert.ok(subcommand.err.includes("unknown task subcommand"));
  assert.equal(merge.code, 2);
  assert.ok(merge.err.includes("is not available"));
});

test("cli: ci usage errors surface as 2", async () => {
  const missing = await run(["ci", "classify"]);
  const subcommand = await run(["ci", "wat"]);
  const shortRevision = await run([
    "ci",
    "classify",
    "--base",
    "main",
    "--head",
    "a".repeat(40),
  ]);

  assert.equal(missing.code, 2);
  assert.ok(missing.err.includes('missing required flag "--base"'));
  assert.equal(subcommand.code, 2);
  assert.ok(subcommand.err.includes("unknown ci subcommand"));
  assert.equal(shortRevision.code, 2);
  assert.ok(shortRevision.err.includes("hex revisions"));
});

test("cli: scaffold and remove usage errors surface as 2", async () => {
  const scaffold = await run(["scaffold"]);
  const feature = await run(["scaffold", "feature"]);
  const remove = await run(["remove", "feature"]);
  const removeFlagOnly = await run(["remove", "feature", "--yes"]);
  const removeEndpoint = await run(["remove", "endpoint"]);

  assert.equal(scaffold.code, 2);
  assert.ok(scaffold.err.includes("unknown scaffold target"));
  assert.equal(feature.code, 2);
  assert.ok(feature.err.includes("needs a <name>"));
  assert.equal(remove.code, 2);
  assert.ok(remove.err.includes("needs an argument"));
  // A flag must never be mistaken for the positional target.
  assert.equal(removeFlagOnly.code, 2);
  assert.ok(removeFlagOnly.err.includes("needs an argument"));
  assert.equal(removeEndpoint.code, 2);
  assert.ok(removeEndpoint.err.includes("needs an argument"));
});
