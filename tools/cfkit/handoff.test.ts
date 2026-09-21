import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runHandoff, scopedPaths } from "./commands-handoff.ts";
import { changedPaths, taskFingerprint } from "./git.ts";
import {
  createApproval,
  markUncertain,
  readApproval,
  verifyApproval,
  writeApproval,
} from "./handoff.ts";

const NOW = 1_000_000;

function approvalWith(
  overrides: Readonly<Record<string, unknown>> = {},
): ReturnType<typeof createApproval> {
  return createApproval({
    taskId: "demo",
    action: "commit",
    changedPaths: ["src/a.ts", "docs/b.md"],
    taskFingerprint: "fingerprint-1",
    challenge: "challenge-1",
    nowMs: NOW,
    ...overrides,
  });
}

function verify(
  overrides: Readonly<Record<string, unknown>> = {},
): ReturnType<typeof verifyApproval> {
  return verifyApproval({
    approval: approvalWith(),
    action: "commit",
    challenge: "challenge-1",
    nowMs: NOW + 1_000,
    changedPaths: ["src/a.ts", "docs/b.md"],
    taskFingerprint: "fingerprint-1",
    ...overrides,
  });
}

test("approval verification accepts a fresh matching challenge", () => {
  assert.deepEqual(verify(), { ok: true });
});

test("approval verification refuses each mismatch with its own reason", () => {
  const cases: readonly [Readonly<Record<string, unknown>>, RegExp][] = [
    [{ approval: undefined }, /dry-run/],
    [{ approval: markUncertain(approvalWith()) }, /not prepared/],
    [{ action: "push" }, /different action/],
    [{ nowMs: NOW + 16 * 60_000 }, /expired/],
    [{ challenge: "other" }, /challenge does not match/],
    [{ taskFingerprint: "fingerprint-2" }, /stale \(revision or paths/],
    [{ changedPaths: ["src/a.ts"] }, /stale \(changed paths/],
  ];

  for (const [overrides, pattern] of cases) {
    const verdict = verify(overrides);

    if (verdict.ok) throw new Error("expected the approval to be refused");

    assert.match(verdict.reason, pattern);
  }
});

test("approvals persist with owner-only permissions", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-handoff-"));

  try {
    const approval = approvalWith();
    const relative = writeApproval(root, approval);

    assert.equal(relative, ".cfkit/tasks/demo/handoff/commit.json");
    assert.deepEqual(readApproval(root, "demo", "commit"), approval);
    assert.equal(
      statSync(join(root, relative)).mode & 0o777,
      0o600,
      "approvals must not be world-readable",
    );
    assert.equal(readApproval(root, "demo", "push"), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the task fingerprint follows the revision and the changed paths", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-handoff-git-"));

  try {
    const git = (args: readonly string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" });

    git(["init", "-b", "main"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    writeFileSync(join(root, "file.txt"), "one\n");
    git(["add", "."]);
    git(["commit", "-m", "initial"]);

    const clean = taskFingerprint(root);

    assert.deepEqual(changedPaths(root), []);
    assert.throws(() => taskFingerprint(join(root, "nope")));

    writeFileSync(join(root, "file.txt"), "two\n");
    mkdirSync(join(root, ".cfkit", "tasks", "demo"), { recursive: true });
    writeFileSync(join(root, ".cfkit", "tasks", "demo", "state.json"), "{}\n");
    const dirty = taskFingerprint(root);

    assert.notEqual(dirty, clean);
    assert.deepEqual(
      changedPaths(root),
      ["file.txt"],
      "task state under .cfkit must never enter a handoff",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unavailable handoff actions are refused", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-handoff-refuse-"));

  try {
    for (const action of ["merge", "deploy", "migrate", "delete-branch"]) {
      assert.equal(runHandoff([action], root), 1, `${action} must be refused`);
    }

    assert.equal(runHandoff(["commit"], root), 1);
    assert.equal(runHandoff(["dry-run"], root), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scopedPaths returns everything, or exactly the validated scope", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-handoff-scope-"));

  try {
    const git = (args: readonly string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" });

    git(["init", "-b", "main"]);
    git(["config", "user.email", "test@example.com"]);
    git(["config", "user.name", "Test"]);
    writeFileSync(join(root, "a.txt"), "one\n");
    writeFileSync(join(root, "b.txt"), "one\n");
    git(["add", "."]);
    git(["commit", "-m", "initial"]);
    writeFileSync(join(root, "a.txt"), "two\n");
    writeFileSync(join(root, "b.txt"), "two\n");

    assert.deepEqual(scopedPaths(root, undefined), ["a.txt", "b.txt"]);
    assert.deepEqual(scopedPaths(root, "b.txt"), ["b.txt"]);
    assert.deepEqual(scopedPaths(root, " b.txt , a.txt "), ["a.txt", "b.txt"]);
    assert.throws(() => scopedPaths(root, "c.txt"), /not currently changed/);
    assert.throws(() => scopedPaths(root, " , "), /lists no paths/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
