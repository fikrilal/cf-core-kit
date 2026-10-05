import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  applyPlants,
  GATE_PROBES,
  hashBytes,
  restorePlants,
  runGateProbe,
} from "./check.mjs";

test("gates: every probe is complete and points at a real wiring", () => {
  assert.ok(GATE_PROBES.length >= 8);
  assert.equal(
    new Set(GATE_PROBES.map((probe) => probe.gate)).size,
    GATE_PROBES.length,
  );

  for (const probe of GATE_PROBES) {
    assert.match(probe.gate, /^[a-z][a-z0-9:-]*$/);
    assert.ok(
      probe.marker.startsWith("["),
      `${probe.gate} needs a real marker`,
    );
    assert.ok(probe.description.length >= 20);
    assert.ok(probe.plant.length >= 1);

    for (const op of probe.plant) {
      assert.ok(["append", "replace", "create", "json"].includes(op.mode));
      if (op.mode === "create") continue;
      assert.ok(
        existsSync(join(process.cwd(), op.file)),
        `${op.file} must exist for the ${probe.gate} probe`,
      );
    }
  }
});

test("gates: the honesty machinery fails when a gate does not fail", () => {
  const passes = runGateProbe({
    command: "node",
    args: ["-e", "process.exit(0)"],
    marker: "never",
    cwd: process.cwd(),
  });

  assert.equal(passes.ok, false);
  assert.match(passes.reason, /passed with a violation planted/);

  const failsSilently = runGateProbe({
    command: "node",
    args: ["-e", "process.exit(1)"],
    marker: "[budget] violations:",
    cwd: process.cwd(),
  });

  assert.equal(failsSilently.ok, false);
  assert.match(failsSilently.reason, /without its marker/);

  const failsWithMarker = runGateProbe({
    command: "node",
    args: ["-e", 'console.error("[budget] violations:"); process.exit(1)'],
    marker: "[budget] violations:",
    cwd: process.cwd(),
  });

  assert.equal(failsWithMarker.ok, true);
});

test("gates: plants are restored byte-identically and created files are removed", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-gates-"));
  const existing = join(root, "existing.txt");
  const created = join(root, "nested/created.txt");

  writeFileSync(existing, "original\n");

  const hashBefore = hashBytes(readFileSync(existing));
  const journal = applyPlants(root, [
    { file: "existing.txt", mode: "append", content: "planted\n" },
    { file: "nested/created.txt", mode: "create", content: "planted\n" },
  ]);

  try {
    assert.equal(readFileSync(existing, "utf8"), "original\nplanted\n");
    assert.equal(readFileSync(created, "utf8"), "planted\n");

    assert.deepEqual(restorePlants(journal, root), []);
    assert.equal(readFileSync(existing, "utf8"), "original\n");
    assert.equal(hashBytes(readFileSync(existing)), hashBefore);
    assert.equal(existsSync(created), false);
    assert.equal(
      existsSync(dirname(created)),
      false,
      "empty parents are pruned",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gates: planting, running and restoring leaves the tree byte-identical", () => {
  const root = mkdtempSync(join(tmpdir(), "cfkit-gates-probe-"));
  const target = join(root, "target.txt");

  writeFileSync(target, "clean\n");

  const hashBefore = hashBytes(readFileSync(target));
  const journal = applyPlants(root, [
    { file: "target.txt", mode: "append", content: "planted\n" },
  ]);

  try {
    assert.equal(readFileSync(target, "utf8"), "clean\nplanted\n");

    const result = runGateProbe({
      command: "node",
      args: ["-e", 'console.error("[probe] violations:"); process.exit(1)'],
      marker: "[probe] violations:",
      cwd: root,
    });

    assert.equal(result.ok, true);

    assert.deepEqual(restorePlants(journal, root), []);
    assert.equal(hashBytes(readFileSync(target)), hashBefore);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
