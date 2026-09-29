import assert from "node:assert/strict";
import { test } from "node:test";

import { validateManifest } from "./harness.mjs";

const ROOT = process.cwd();
const SCRIPTS = new Set(["verify"]);

function baseManifest() {
  return {
    schemaVersion: 1,
    rows: [
      {
        id: "core.thing",
        area: "verification core",
        family: "family path",
        target: "our target",
        status: "present",
        plan: 1,
        evidencePath: "package.json",
      },
      {
        id: "core.other",
        area: "verification core",
        family: "family path",
        target: "our target",
        status: "declared-only",
        plan: 2,
      },
    ],
  };
}

function violations(manifest) {
  return validateManifest(manifest, { root: ROOT, scriptNames: SCRIPTS });
}

test("parity manifest: a well-formed manifest passes", () => {
  assert.deepEqual(violations(baseManifest()), []);
});

test("parity manifest: malformed rows fail", () => {
  const badId = baseManifest();
  badId.rows[0].id = "Nope";
  assert.ok(
    violations(badId).some((entry) => entry.includes("dotted kebab-case")),
  );

  const duplicate = baseManifest();
  duplicate.rows[1].id = "core.thing";
  assert.ok(
    violations(duplicate).some((entry) => entry.includes("duplicate id")),
  );

  const badStatus = baseManifest();
  badStatus.rows[1].status = "maybe";
  assert.ok(
    violations(badStatus).some((entry) => entry.includes("unknown status")),
  );

  const badPlan = baseManifest();
  badPlan.rows[0].plan = 0;
  assert.ok(
    violations(badPlan).some((entry) => entry.includes("plan must be")),
  );

  const missingField = baseManifest();
  delete missingField.rows[0].target;
  assert.ok(
    violations(missingField).some((entry) => entry.includes("missing target")),
  );
});

test("parity manifest: present rows must carry valid evidence", () => {
  const noEvidence = baseManifest();
  delete noEvidence.rows[0].evidencePath;
  assert.ok(
    violations(noEvidence).some((entry) => entry.includes("need evidencePath")),
  );

  const missingPath = baseManifest();
  missingPath.rows[0].evidencePath = "nope/missing.ts";
  assert.ok(
    violations(missingPath).some((entry) => entry.includes("does not exist")),
  );

  const badCommand = baseManifest();
  delete badCommand.rows[0].evidencePath;
  badCommand.rows[0].evidenceCommand = "nope:cmd";
  assert.ok(
    violations(badCommand).some((entry) =>
      entry.includes("not a package.json script"),
    ),
  );

  const liar = baseManifest();
  liar.rows[1].evidencePath = "package.json";
  assert.ok(
    violations(liar).some((entry) => entry.includes("must not claim evidence")),
  );

  const wrongType = baseManifest();
  wrongType.rows[0].evidencePath = true;
  assert.ok(
    violations(wrongType).some((entry) =>
      entry.includes("evidencePath must be a string"),
    ),
  );

  const wrongCommandType = baseManifest();
  delete wrongCommandType.rows[0].evidencePath;
  wrongCommandType.rows[0].evidenceCommand = 7;
  assert.ok(
    violations(wrongCommandType).some((entry) =>
      entry.includes("evidenceCommand must be a string"),
    ),
  );
});

test("parity manifest: an empty or malformed manifest fails", () => {
  assert.ok(violations({ schemaVersion: 1, rows: [] }).length > 0);
  assert.ok(
    violations({ schemaVersion: 2, rows: baseManifest().rows }).some((entry) =>
      entry.includes("schemaVersion"),
    ),
  );
});
