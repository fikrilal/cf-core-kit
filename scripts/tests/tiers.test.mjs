import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const scripts = JSON.parse(
  readFileSync(join(process.cwd(), "package.json"), "utf8"),
).scripts;

const TIERS = [
  { script: "test:unit", dirs: ["src", "test/support"] },
  { script: "test:int", dirs: ["test/integration"] },
  { script: "test:contract", dirs: ["test/contract"] },
];

function specFiles(directory, found = []) {
  for (const entry of readdirSync(join(process.cwd(), directory), {
    withFileTypes: true,
  })) {
    const path = `${directory}/${entry.name}`;

    if (entry.isDirectory()) specFiles(path, found);
    else if (path.endsWith(".spec.ts")) found.push(path);
  }

  return found;
}

test("tiers: every tier script exists and filters its directories", () => {
  for (const tier of TIERS) {
    const command = scripts[tier.script];

    assert.ok(typeof command === "string", `${tier.script} is not wired`);
    assert.match(command, /^vitest run /, `${tier.script} must run vitest`);

    for (const directory of tier.dirs) {
      assert.ok(
        command.includes(directory),
        `${tier.script} does not filter ${directory}`,
      );
    }
  }

  assert.equal(scripts.test, "vitest run");
});

test("tiers: every spec file belongs to at least one tier", () => {
  const specs = [...specFiles("src"), ...specFiles("test")];
  const unowned = specs.filter(
    (file) =>
      !TIERS.some((tier) =>
        tier.dirs.some((dir) => file.startsWith(`${dir}/`)),
      ),
  );

  assert.deepEqual(unowned, [], "spec files outside every tier");
});

test("tiers: the coverage reporters and floors stay pinned", () => {
  const config = readFileSync(join(process.cwd(), "vitest.config.ts"), "utf8");

  for (const reporter of ["text-summary", "lcov", "json-summary"]) {
    assert.ok(config.includes(`"${reporter}"`), `missing reporter ${reporter}`);
  }

  for (const floor of [
    "statements: 85",
    "branches: 78",
    "functions: 90",
    "lines: 88",
  ]) {
    assert.ok(config.includes(floor), `missing coverage floor ${floor}`);
  }
});

test("tiers: the ci workflow uploads coverage with a pinned action", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github", "workflows", "ci.yml"),
    "utf8",
  );

  assert.match(
    workflow,
    /uses: actions\/upload-artifact@[0-9a-f]{40} # v\d+/,
    "the coverage artifact action must be commit-pinned",
  );
  assert.match(workflow, /path: coverage\//);
  assert.match(workflow, /retention-days: 7/);
});
