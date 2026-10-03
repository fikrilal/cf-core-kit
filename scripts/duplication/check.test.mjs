import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  categorizeClone,
  cloneViolation,
  findViolations,
  renderDuplicationReport,
  resolveProfile,
  runDuplication,
} from "./check.mjs";

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

const CLONE_FILES = [CLONE.firstFile.name, CLONE.secondFile.name];

test("cloneViolation renders the compact clone description", () => {
  assert.equal(
    cloneViolation(CLONE),
    "scripts/budget/check.mjs <-> scripts/drift/check.mjs (17 lines, 81 tokens)",
  );
});

test("categorizeClone names the repeated pattern, or nothing", () => {
  const categorize = (first, second) =>
    categorizeClone({
      firstFile: { name: first },
      secondFile: { name: second },
    });

  assert.equal(
    categorize("src/features/a/repository.ts", "src/features/b/repository.ts"),
    "query-builders",
  );
  assert.equal(
    categorize("src/platform/rate-limit/a.ts", "src/platform/rate-limit/b.ts"),
    "rate-limiting",
  );
  assert.equal(
    categorize("src/features/a/a.routes.ts", "src/features/b/b.routes.ts"),
    "route-wiring",
  );
  assert.equal(categorize("src/a/unrelated.ts", "src/b/other.ts"), undefined);
});

test("profiles differ in threshold and severity policy", () => {
  const core = resolveProfile("core");
  const smallHelpers = resolveProfile("small-helpers");

  assert.equal(core?.fatalByDefault, true);
  assert.equal(smallHelpers?.fatalByDefault, false);
  assert.ok((smallHelpers?.minTokens ?? 0) < (core?.minTokens ?? 0));
  assert.equal(resolveProfile("nope"), undefined);
});

const SMALL_BLOCK = `  const value = readSomething();
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  const parts = normalized.split("-");
  return parts.filter((part) => part !== "").join("_");
`;

function smallCloneRoot() {
  const root = mkdtempSync(join(tmpdir(), "cfkit-small-helper-"));

  for (const file of ["src/a/one.ts", "src/b/two.ts"]) {
    const path = join(root, file);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      `export function normalize(input: string) {\n${SMALL_BLOCK}}\n`,
    );
  }

  return root;
}

test("the small-helper profile catches what the core profile ignores", () => {
  const root = smallCloneRoot();

  try {
    const small = runDuplication(root, {
      profile: "small-helpers",
      allowlist: { reviewedAcceptable: [] },
    });
    const core = runDuplication(root, {
      profile: "core",
      allowlist: { reviewedAcceptable: [] },
    });

    assert.ok(small.clones >= 1, "the small-helper profile must see the clone");
    assert.ok(small.violations.length >= 1);
    assert.equal(core.clones, 0, "the core profile's floor must ignore it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a reviewed allowlist entry suppresses a small-helper clone", () => {
  const root = smallCloneRoot();

  try {
    const result = runDuplication(root, {
      profile: "small-helpers",
      allowlist: {
        reviewedAcceptable: [
          { reason: "fixture", files: ["src/a/one.ts", "src/b/two.ts"] },
        ],
      },
    });

    assert.equal(result.violations.length, 0);
    assert.equal(result.allowlisted, result.clones);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the report renders both profiles, categories and allowlists", () => {
  const report = renderDuplicationReport([
    {
      profile: "core",
      label: "Core",
      minTokens: 60,
      minLines: 7,
      statistics: { total: { percentage: 0.09 } },
      clones: 1,
      allowlisted: 1,
      violations: [],
      actionableClones: [],
      duplicates: [CLONE],
      groups: [{ reason: "entrypoint boilerplate", files: CLONE_FILES }],
    },
    {
      profile: "small-helpers",
      label: "Small helpers",
      minTokens: 24,
      minLines: 4,
      statistics: { total: { percentage: 1.5 } },
      clones: 2,
      allowlisted: 0,
      violations: [
        "src/a/repository.ts <-> src/b/repository.ts (5 lines, 30 tokens)",
      ],
      actionableClones: [
        {
          lines: 5,
          tokens: 30,
          firstFile: { name: "src/a/repository.ts" },
          secondFile: { name: "src/b/repository.ts" },
        },
      ],
      duplicates: [],
      groups: [],
    },
  ]);

  assert.match(report, /## Core \(min 60 tokens \/ 7 lines\)/);
  assert.match(report, /## Small helpers \(min 24 tokens \/ 4 lines\)/);
  assert.match(report, /### query-builders/);
  assert.match(report, /### allowlisted \(reviewed\)/);
  assert.match(report, /entrypoint boilerplate/);
});
