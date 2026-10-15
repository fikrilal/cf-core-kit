import assert from "node:assert/strict";
import { test } from "node:test";

import { MIN_MAPPED_ROWS, readJson, validateMap } from "./tree.mjs";

const ROOT = process.cwd();
const family = process.env.FAMILY_ROOT;

test("parity tree: the shipped map validates against the manifest", () => {
  assert.deepEqual(validateMap(ROOT), []);

  const map = readJson(ROOT, "tools/parity/family-map.json");

  assert.ok(map.entries.length >= MIN_MAPPED_ROWS);
  assert.match(map.recordedOn, /^\d{4}-\d{2}-\d{2}$/);

  // Recorded deviations carry a reason.
  for (const entry of map.entries) {
    if (entry.familyPath !== null) continue;

    assert.ok(
      typeof entry.note === "string" && entry.note.length >= 20,
      entry.id,
    );
  }
});

test("parity tree: the live comparison runs when a family checkout is provided", () => {
  if (family === undefined) {
    // The live half needs the family tree, which CI does not have; the offline half is asserted above.
    assert.ok(true);

    return;
  }

  assert.deepEqual(validateMap(ROOT, family), []);
});

test("parity tree: a foreign row, a wrong kind and an unexplained null are refused", () => {
  const map = readJson(ROOT, "tools/parity/family-map.json");
  const first = map.entries[0];
  const validate = (entry) =>
    validateMap(ROOT, undefined, { ...map, entries: [entry] });

  assert.ok(
    validate({ ...first, id: "not-a-row" }).some((problem) =>
      problem.includes("is not a manifest row"),
    ),
  );
  assert.ok(
    validate({ ...first, familyPath: null, note: "short" }).some((problem) =>
      problem.includes("needs a note"),
    ),
  );
  assert.ok(
    validate({ ...first, kind: "symlink" }).some((problem) =>
      problem.includes("kind file|dir"),
    ),
  );
  assert.ok(
    validate({ ...first, familyPath: "" }).some((problem) =>
      problem.includes("needs a familyPath or null"),
    ),
  );

  // An empty map is not a passing map.
  assert.ok(
    validateMap(ROOT, undefined, { ...map, entries: [] }).some((problem) =>
      problem.includes("at least"),
    ),
  );
});
