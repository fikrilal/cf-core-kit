import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { findViolations } from "./check.mjs";

const CLONE = {
  lines: 17,
  tokens: 81,
  firstFile: { name: "scripts/budget/check.mjs" },
  secondFile: { name: "scripts/drift/check.mjs" },
};

test("a pair covered by one reviewed group is allowed", () => {
  const groups = [
    {
      reason: "entrypoint boilerplate",
      files: [CLONE.firstFile.name, CLONE.secondFile.name],
    },
  ];

  assert.deepEqual(findViolations([CLONE], groups), []);
});

test("a pair only half-covered is a violation", () => {
  const groups = [
    { reason: "one-sided", files: [CLONE.firstFile.name, "other.mjs"] },
  ];

  const violations = findViolations([CLONE], groups);

  assert.equal(violations.length, 1);
  assert.match(
    violations[0],
    /budget\/check\.mjs <-> scripts\/drift\/check\.mjs/,
  );
});

test("an empty allowlist makes every clone a violation", () => {
  assert.equal(findViolations([CLONE], []).length, 1);
});

test("the committed allowlist entries carry reasons", () => {
  const allowlist = JSON.parse(
    readFileSync(
      join(process.cwd(), "tools", "duplication-allowlist.json"),
      "utf8",
    ),
  );

  for (const group of allowlist.reviewedAcceptable) {
    assert.ok(group.reason.length > 0);
    assert.ok(group.files.length >= 2);
  }
});
