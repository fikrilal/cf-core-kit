import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parse, stringify } from "yaml";

import { lintSpec } from "./lint.mjs";

const ROOT = process.cwd();

function lintMutatedSpec(mutate) {
  const raw = readFileSync(
    join(ROOT, "docs", "openapi", "openapi.yaml"),
    "utf8",
  );
  const document = parse(raw);

  mutate(document);

  const tempDir = mkdtempSync(join(tmpdir(), "cfkit-lint-"));
  const target = join(tempDir, "openapi.yaml");

  try {
    writeFileSync(target, stringify(document, { indent: 2 }));
    const result = lintSpec(ROOT, target);

    return {
      status: result.status,
      output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

test("spectral: the committed spec passes the family ruleset", () => {
  const result = lintSpec(ROOT, "docs/openapi/openapi.yaml");

  assert.equal(
    result.status,
    0,
    `${result.stdout ?? ""}${result.stderr ?? ""}`,
  );
});

test("spectral: a missing x-error-codes fails the gate-honesty probe", () => {
  const result = lintMutatedSpec((document) => {
    delete document.paths["/health"].get["x-error-codes"];
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /x-error-codes-required/);
});

test("spectral: a missing operationId fails the probe", () => {
  const result = lintMutatedSpec((document) => {
    delete document.paths["/health"].get.operationId;
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /operation-operationId/);
});

test("spectral: missing tags fail the probe", () => {
  const result = lintMutatedSpec((document) => {
    delete document.paths["/health"].get.tags;
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /operation-tags/);
});
