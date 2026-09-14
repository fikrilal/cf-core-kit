import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();

function lintSnippet(file, content) {
  try {
    const output = execFileSync(
      "npx",
      ["--no-install", "eslint", "--stdin", "--stdin-filename", file],
      {
        cwd: ROOT,
        input: content,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    return { failed: false, output };
  } catch (error) {
    return {
      failed: true,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}

function pickFile(dir) {
  const entries = readdirSync(join(ROOT, dir));

  return entries.find(
    (name) => name.endsWith(".ts") && !name.endsWith(".spec.ts"),
  );
}

function deepModule(feature) {
  const entries = readdirSync(join(ROOT, "src", "features", feature));

  return entries.find(
    (name) =>
      name.endsWith(".ts") && !name.endsWith(".spec.ts") && name !== "index.ts",
  );
}

function expectBlocked(result, pattern) {
  assert.equal(
    result.failed,
    true,
    `expected lint to fail; got:\n${result.output}`,
  );
  assert.match(result.output, pattern);
}

test("boundary zones: platform must not import features", () => {
  const file = `src/platform/health/${pickFile("src/platform/health")}`;

  expectBlocked(
    lintSnippet(
      file,
      'import * as probe from "../../features/users";\nexport const value = probe;\n',
    ),
    /platform must not import features/,
  );
});

test("boundary zones: features must not import app entry modules", () => {
  const file = `src/features/users/${pickFile("src/features/users")}`;

  expectBlocked(
    lintSnippet(
      file,
      'import * as probe from "../../app";\nexport const value = probe;\n',
    ),
    /features must not import app entry modules/,
  );
});

test("boundary zones: shared stays framework-free", () => {
  const file = `src/shared/${pickFile("src/shared")}`;

  expectBlocked(
    lintSnippet(
      file,
      'import * as probe from "../platform/clock/clock";\nexport const value = probe;\n',
    ),
    /framework-free/,
  );
});

test("boundary zones: every feature pair blocks deep imports", () => {
  const features = readdirSync(join(ROOT, "src", "features"));

  for (const source of features) {
    const sourceFile = pickFile(`src/features/${source}`);

    for (const target of features) {
      if (source === target) continue;

      const module = deepModule(target);
      if (module === undefined) continue;

      const modulePath = module.replace(/\.ts$/, "");
      const result = lintSnippet(
        `src/features/${source}/${sourceFile}`,
        `import * as probe from "../${target}/${modulePath}";\nexport const value = probe;\n`,
      );

      expectBlocked(result, /cross-feature imports go through/);
    }
  }
});
