import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  applyMutation,
  hashBytes,
  MUTATIONS,
  renderReport,
  restoreMutation,
  runMutation,
  runPilot,
  validateMutations,
} from "./pilot.mjs";

/**
 * The pilot mutates real sources, so these fixtures never do: they run against a temp copy with an injected
 * runner. `npm run test:mutation` is where the shipped catalogue runs for real — concurrently running this
 * file next to the specs it mutates would flake them.
 */
function tempMutation(id = "fixture.copy") {
  const directory = mkdtempSync(join(tmpdir(), "cfkit-mutation-"));
  const target = MUTATIONS[0];
  const file = join(directory, target.file.split("/").at(-1));

  copyFileSync(target.file, file);

  return {
    mutation: { ...target, id, file },
    directory,
  };
}

test("mutation: the catalogue is well formed and every anchor is present", () => {
  assert.ok(MUTATIONS.length >= 6, "the pilot needs a real catalogue");
  assert.deepEqual(validateMutations(MUTATIONS), []);

  for (const mutation of MUTATIONS) {
    assert.match(mutation.id, /^[a-z]+(\.[a-z0-9-]+)+$/);
    assert.ok(mutation.description.length >= 20, mutation.id);
    assert.ok(mutation.spec.endsWith(".test.ts"), mutation.spec);
    assert.notEqual(mutation.find, mutation.replace);
  }
});

test("mutation: applying and restoring a mutation is byte-identical", () => {
  const { mutation, directory } = tempMutation();
  const before = readFileSync(mutation.file);

  try {
    const entry = applyMutation(mutation);

    try {
      assert.notEqual(
        readFileSync(mutation.file, "utf8"),
        before.toString("utf8"),
      );
    } finally {
      restoreMutation(entry);
    }

    assert.equal(hashBytes(readFileSync(mutation.file)), hashBytes(before));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mutation: a passing spec is a survivor and a failing spec is killed", () => {
  const { mutation, directory } = tempMutation();

  try {
    // `sh -c "exit 0"` stands in for a spec that still passes with the mutation applied; `exit 1` for one
    // that notices. Real runs use `node --test <spec>`.
    const survivor = runMutation(mutation, {
      command: "sh",
      argsFor: () => ["-c", "exit 0"],
    });
    const killed = runMutation(mutation, {
      command: "sh",
      argsFor: () => ["-c", "exit 1"],
    });

    assert.equal(survivor.detected, false);
    assert.equal(killed.detected, true);
    assert.equal(typeof survivor.output, "string");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mutation: the pilot reports survivors instead of hiding them", () => {
  const { mutation, directory } = tempMutation("fixture.survivor");

  try {
    const surviving = runPilot({
      mutations: [mutation],
      command: "sh",
      argsFor: () => ["-c", "exit 0"],
    });

    assert.deepEqual(surviving.survived, ["fixture.survivor"]);
    assert.equal(surviving.killed, 0);

    const killing = runPilot({
      mutations: [mutation],
      command: "sh",
      argsFor: () => ["-c", "exit 1"],
    });

    assert.deepEqual(killing.survived, []);
    assert.equal(killing.killed, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("mutation: the report records the catalogue, kills and survivors", () => {
  const report = JSON.parse(
    renderReport({
      killed: 1,
      survived: ["risk.unknown-default-renamed"],
      results: [
        {
          id: "risk.raise-only-neutered",
          file: "tools/cfkit/risk-classifier.ts",
          spec: "tools/cfkit/risk-classifier.test.ts",
          description: "effectiveRisk stops raising the declared risk",
          detected: true,
          output: "",
        },
      ],
    }),
  );

  assert.equal(report.catalogue, MUTATIONS.length);
  assert.equal(report.killed, 1);
  assert.deepEqual(report.survived, ["risk.unknown-default-renamed"]);
  assert.equal(report.results[0].detected, true);
  assert.match(report.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("mutation: a catalogue with a missing anchor is rejected", () => {
  const problems = validateMutations([
    {
      id: "fixture.missing-anchor",
      file: "tools/cfkit/duration-policy.ts",
      spec: "tools/cfkit/cfkit.test.ts",
      find: "this text does not exist anywhere",
      replace: "x",
      description: "a mutation whose anchor has drifted away",
    },
  ]);

  assert.deepEqual(problems, [
    "fixture.missing-anchor: anchor not found in tools/cfkit/duration-policy.ts",
  ]);
});
