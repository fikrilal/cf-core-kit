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
  findingsAtOrAbove,
  findingKey,
  loadBaseline,
  missingFromBaseline,
  RULES,
  scanRepository,
} from "./check.mjs";

const REGISTRY =
  'import { createXJobs } from "./features/x/x.jobs";\nexport const jobs = [createXJobs];\n';

/** A throwaway repo whose registry imports the module under test (rule helpers read both). */
function fixtureRoot(files) {
  const root = mkdtempSync(join(tmpdir(), "cfkit-smells-"));

  for (const [path, source] of Object.entries({
    "src/jobs.ts": REGISTRY,
    "src/shared/error-codes.ts":
      'export enum ErrorCode {\n  VALIDATION_FAILED = "VALIDATION_FAILED",\n}\n',
    ...files,
  })) {
    const filePath = join(root, path);

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }

  return root;
}

function scan(root, files) {
  return scanRepository({
    root,
    files: Object.keys(files),
    sourceFor: (file) => files[file],
  });
}

test("smells: the rule table is well formed", () => {
  const ids = RULES.map((rule) => rule.id);

  assert.equal(new Set(ids).size, ids.length);

  for (const rule of RULES) {
    assert.match(rule.id, /^[a-z][a-z0-9_]*$/);
    assert.ok(["low", "medium", "high"].includes(rule.severity));
    assert.ok(
      rule.description.length >= 40,
      `${rule.id} needs a real description`,
    );
    assert.match(
      rule.docsLink,
      /^(docs|AGENTS)/,
      `${rule.id} needs a docsLink`,
    );
    assert.equal(typeof rule.scan, "function");
  }
});

test("smells: a clean tree produces nothing", () => {
  const files = {
    "src/features/x/x.service.ts": "export const value = 1;\n",
  };
  const root = fixtureRoot(files);

  try {
    assert.deepEqual(scan(root, files), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("smells: uncomposed_job_module fires when the registry does not import the module", () => {
  const files = {
    "src/features/orphan/orphan.jobs.ts":
      'import { defineJob } from "./registry.ts";\nexport const job = defineJob({ name: "orphan.run", payloadSchema, handle });\n',
  };
  const root = fixtureRoot(files);

  try {
    const findings = scan(root, files);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, "uncomposed_job_module");
    assert.equal(findings[0].severity, "high");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("smells: uncomposed_job_module stays quiet for a composed module", () => {
  const files = {
    "src/features/x/x.jobs.ts":
      'import { defineJob } from "./registry.ts";\nexport const job = defineJob({ name: "x.run", payloadSchema, handle });\n',
  };
  const root = fixtureRoot(files);

  try {
    assert.deepEqual(scan(root, files), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("smells: raw_error_code_literal fires outside the enum definition", () => {
  const files = {
    "src/features/x/x.service.ts": 'export const code = "VALIDATION_FAILED";\n',
  };
  const root = fixtureRoot(files);

  try {
    const findings = scan(root, files);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, "raw_error_code_literal");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("smells: wall_clock_in_feature fires in features only", () => {
  const files = {
    "src/features/x/x.service.ts": "export const at = Date.now();\n",
    "src/platform/logging/logger.ts": "export const at = Date.now();\n",
  };
  const root = fixtureRoot(files);

  try {
    const findings = scan(root, files);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, "wall_clock_in_feature");
    assert.equal(findings[0].file, "src/features/x/x.service.ts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("smells: console_usage_outside_logger allows the logging module", () => {
  const files = {
    "src/features/x/x.service.ts": 'console.warn("hi");\n',
    "src/platform/logging/redact.ts": 'console.warn("hi");\n',
  };
  const root = fixtureRoot(files);

  try {
    const findings = scan(root, files);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, "src/features/x/x.service.ts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("smells: untracked_todo fires on debt markers", () => {
  const files = {
    "src/features/x/x.service.ts": "// TODO: revisit this\n",
  };
  const root = fixtureRoot(files);

  try {
    const findings = scan(root, files);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, "untracked_todo");
    assert.equal(findings[0].severity, "low");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("smells: the baseline suppresses findings by rule and file, and the floor filters", () => {
  const finding = {
    ruleId: "raw_error_code_literal",
    file: "src/features/x/x.service.ts",
    severity: "medium",
    line: 1,
    detail: "x",
  };
  const baseline = { schemaVersion: 1, keys: [{ key: findingKey(finding) }] };

  assert.deepEqual(missingFromBaseline([finding], baseline), []);
  assert.equal(findingsAtOrAbove([finding], "high").length, 0);
  assert.equal(findingsAtOrAbove([finding], "medium").length, 1);
});

test("smells: the shipped baseline is valid and empty", () => {
  const baseline = loadBaseline(process.cwd());

  assert.equal(baseline.schemaVersion, 1);
  assert.deepEqual(baseline.keys, []);
});

test("smells: a missing or malformed baseline is rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-smells-baseline-"));

  try {
    assert.throws(() => loadBaseline(root), /ENOENT|no such file/);

    mkdirSync(join(root, "tools"), { recursive: true });
    writeFileSync(
      join(root, "tools/smells-baseline.json"),
      JSON.stringify({ schemaVersion: 2, keys: [] }),
    );
    assert.throws(() => loadBaseline(root), /schemaVersion: 1/);

    writeFileSync(
      join(root, "tools/smells-baseline.json"),
      JSON.stringify({ schemaVersion: 1, keys: "nope" }),
    );
    assert.throws(() => loadBaseline(root), /keys: \[\.\.\.\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("smells: the repository scans clean", () => {
  const findings = scanRepository({
    root: process.cwd(),
    sourceFor: (file) => readFileSync(file, "utf8"),
  });

  assert.deepEqual(findings, []);
});
