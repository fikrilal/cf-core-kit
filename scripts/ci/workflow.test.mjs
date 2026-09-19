import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const WORKFLOW = readFileSync(
  join(process.cwd(), ".github", "workflows", "ci.yml"),
  "utf8",
);

test("ci workflow: every action is pinned to a 40-hex commit with its tag in a comment", () => {
  const uses = WORKFLOW.split("\n")
    .map((line) => line.trim().replace(/^- /, ""))
    .filter((line) => line.startsWith("uses:"));

  assert.ok(uses.length >= 2, "expected at least checkout and setup-node");

  for (const line of uses) {
    assert.match(
      line,
      /^uses: [\w-]+\/[\w-]+@[0-9a-f]{40} # v\d+$/,
      `unpinned action: ${line}`,
    );
  }
});

test("ci workflow: least-privilege permissions only", () => {
  assert.match(WORKFLOW, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(WORKFLOW, /permissions:[\s\S]*?write/m);
});

test("ci workflow: runs the full ci profile with dev dependencies", () => {
  assert.match(WORKFLOW, /run: npm ci --include=dev/);
  assert.match(WORKFLOW, /run: npm run verify:ci/);
  assert.match(WORKFLOW, /^concurrency:$/m);
  assert.match(WORKFLOW, /cancel-in-progress: true/);
});
