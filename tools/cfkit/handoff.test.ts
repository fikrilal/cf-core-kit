import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
  FORBIDDEN_GH_FLAGS,
  FORBIDDEN_GIT_FLAGS,
  GH_DRAFT_PR_ARGS,
  markUncertain,
  readApproval,
  verifyApproval,
  writeApproval,
} from "./handoff.ts";

const NOW = 1_000_000;

/** Narrowing lives here, so the assertions can read straight through. */
function reasonOf(verdict: ReturnType<typeof verifyApproval>): string {
  if (verdict.ok) throw new Error("expected the approval to be refused");

  return verdict.reason;
}

function approvalWith(
  overrides: Readonly<Record<string, unknown>> = {},
): ReturnType<typeof createApproval> {
  return createApproval({
    taskId: "demo",
    action: "commit",
    changedPaths: ["src/a.ts", "docs/b.md"],
    taskFingerprint: "fingerprint-1",
    branch: "main",
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
    branch: "main",
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
      assert.throws(
        () => runHandoff([action], root),
        /is not available/,
        `${action} must be refused as a usage error`,
      );
    }

    // Missing required flags are usage errors, not domain refusals.
    assert.throws(() => runHandoff(["commit"], root), /missing required flag/);
    assert.throws(() => runHandoff(["dry-run"], root), /missing required flag/);
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

test("approval verification refuses a checkout on another branch", () => {
  const verdict = verify({ branch: "feature/other" });

  assert.match(
    reasonOf(verdict),
    /issued on branch main, the checkout is on feature\/other/,
  );
});

test("approval verification binds the workspace in both directions", () => {
  const bound = approvalWith({ workspacePath: ".cfkit/worktrees/demo" });

  assert.deepEqual(
    verify({ approval: bound, workspacePath: ".cfkit/worktrees/demo" }),
    { ok: true },
  );

  const elsewhere = verify({
    approval: bound,
    workspacePath: ".cfkit/worktrees/other",
  });

  assert.match(
    reasonOf(elsewhere),
    /bound to workspace \.cfkit\/worktrees\/demo/,
  );

  // An approval issued without a workspace cannot spend itself once the task has one.
  const singleTree = verify({ workspacePath: ".cfkit/worktrees/demo" });

  assert.match(
    reasonOf(singleTree),
    /without a workspace, but this task now has one/,
  );
});

test("approvals store the challenge hash, never the challenge", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-handoff-"));

  try {
    const relative = writeApproval(root, approvalWith());
    const raw = readFileSync(join(root, relative), "utf8");

    assert.ok(raw.includes("challengeHash"));
    assert.ok(!raw.includes("challenge-1"));
    assert.match(raw, /"branch": "main"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the adapter's refusal set is data, and the source carries no forbidden flag", () => {
  assert.deepEqual([...GH_DRAFT_PR_ARGS].slice(0, 3), [
    "pr",
    "create",
    "--draft",
  ]);

  for (const flag of [...FORBIDDEN_GH_FLAGS, ...FORBIDDEN_GIT_FLAGS]) {
    assert.ok(
      !GH_DRAFT_PR_ARGS.includes(flag),
      `the draft-PR adapter must not pass ${flag}`,
    );
  }

  const source = readFileSync(
    join(process.cwd(), "tools", "cfkit", "commands-handoff.ts"),
    "utf8",
  );

  for (const flag of FORBIDDEN_GIT_FLAGS) {
    assert.ok(
      !source.includes(`"${flag}"`),
      `commands-handoff.ts must not use ${flag}`,
    );
  }
  for (const flag of ["merge", "ready", "--web", "--auto-merge"]) {
    assert.ok(
      !source.includes(`"${flag}"`),
      `commands-handoff.ts must not use ${flag}`,
    );
  }
});
