import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  classifyChange,
  formatClassification,
  REVISION_PATTERN,
} from "./ci-classify.ts";

function git(root: string, args: readonly string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function commit(
  root: string,
  file: string,
  contents: string,
  message: string,
): string {
  const filePath = join(root, file);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
  git(root, ["add", "--", file]);
  git(root, [
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "-m",
    message,
  ]);

  return git(root, ["rev-parse", "HEAD"]).trim();
}

function commitEverything(root: string, message: string): string {
  git(root, ["add", "-A"]);
  git(root, [
    "-c",
    "user.name=fixture",
    "-c",
    "user.email=fixture@example.com",
    "commit",
    "-m",
    message,
  ]);

  return git(root, ["rev-parse", "HEAD"]).trim();
}

function fixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "cfkit-ci-classify-"));

  git(root, ["init", "--quiet", "-b", "main"]);

  return root;
}

test("ci classify: docs-only ranges are low without runtime", () => {
  const root = fixtureRepo();

  try {
    const base = commit(root, "README.md", "x\n", "one");
    const head = commit(root, "docs/README.md", "y\n", "two");
    const result = classifyChange({ root, base, head });

    assert.equal(result.effectiveRisk, "low");
    assert.equal(result.runtimeRequired, false);
    assert.equal(result.lane, "fast");
    assert.deepEqual(result.changedPaths, ["docs/README.md"]);
    assert.equal(
      formatClassification(result),
      "effective_risk=low\nruntime_required=false\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ci classify: auth and migration changes are high with runtime required", () => {
  const root = fixtureRepo();

  try {
    const base = commit(root, "README.md", "x\n", "one");
    const auth = commit(
      root,
      "src/platform/auth/guard.ts",
      "export {};\n",
      "two",
    );
    const migrations = commit(
      root,
      "db/migrations/0009_x.sql",
      "select 1;\n",
      "three",
    );

    const authResult = classifyChange({ root, base, head: auth });

    assert.equal(authResult.effectiveRisk, "high");
    assert.equal(authResult.runtimeRequired, true);
    assert.equal(authResult.lane, "ci");
    assert.deepEqual(authResult.rules, ["high.auth"]);

    const migrationResult = classifyChange({ root, base, head: migrations });

    assert.equal(migrationResult.effectiveRisk, "high");
    assert.equal(migrationResult.runtimeRequired, true);
    assert.deepEqual(migrationResult.rules, ["high.auth", "high.data"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ci classify: a plan's declared risk can only raise the result", () => {
  const root = fixtureRepo();

  try {
    const base = commit(root, "README.md", "x\n", "one");
    const head = commit(
      root,
      "docs/exec-plans/active/2026-10-12_fixture.md",
      "# Fixture\n\n- Risk: high\n",
      "two",
    );
    const result = classifyChange({ root, base, head });

    assert.equal(result.declaredRisk, "high");
    assert.equal(result.effectiveRisk, "high");
    assert.equal(result.runtimeRequired, false);
    assert.equal(result.lane, "full");
    assert.deepEqual(result.rules, ["low.docs"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ci classify: a plan deleted in the range neither crashes nor declares risk", () => {
  const root = fixtureRepo();

  try {
    // The plan exists at the merge-base and is deleted inside the range, so the diff
    // reports a deletion whose blob no longer exists at `head`.
    const base = commit(
      root,
      "docs/exec-plans/active/2026-10-12_temp.md",
      "# Temp\n\n- Risk: high\n",
      "one",
    );
    rmSync(join(root, "docs/exec-plans/active/2026-10-12_temp.md"));
    const head = commitEverything(root, "two");
    const result = classifyChange({ root, base, head });

    assert.equal(
      result.changedPaths.includes("docs/exec-plans/active/2026-10-12_temp.md"),
      true,
      "the deleted plan is part of the range",
    );
    assert.equal(result.declaredRisk, undefined);
    assert.equal(result.effectiveRisk, "low");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ci classify: completing a plan in the range raises the risk", () => {
  const root = fixtureRepo();

  try {
    const base = commit(root, "README.md", "x\n", "one");
    commit(
      root,
      "docs/exec-plans/active/2026-10-12_done.md",
      "# Done\n\n- Risk: high\n",
      "two",
    );
    mkdirSync(join(root, "docs/exec-plans/completed"), { recursive: true });
    git(root, [
      "mv",
      "docs/exec-plans/active/2026-10-12_done.md",
      "docs/exec-plans/completed/2026-10-12_done.md",
    ]);
    const head = commitEverything(root, "three");
    const result = classifyChange({ root, base, head });

    assert.equal(result.declaredRisk, "high");
    assert.equal(result.effectiveRisk, "high");
    assert.equal(result.runtimeRequired, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ci classify: an unresolvable range fails with an actionable message", () => {
  const root = fixtureRepo();

  try {
    commit(root, "README.md", "x\n", "one");
    const head = git(root, ["rev-parse", "HEAD"]).trim();

    assert.throws(
      () => classifyChange({ root, base: "a".repeat(40), head }),
      /cannot diff .*fetch-depth/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ci classify: revisions must be hex hashes", () => {
  assert.equal(REVISION_PATTERN.test("a".repeat(40)), true);
  assert.equal(REVISION_PATTERN.test("a".repeat(64)), true);
  assert.equal(REVISION_PATTERN.test("z".repeat(40)), false);
  assert.equal(REVISION_PATTERN.test("main"), false);
});
