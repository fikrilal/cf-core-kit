import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  isRemovedPath,
  pruneBaselines,
  SMELLS_BASELINE_PATH,
} from "./baseline-pruner.ts";
import { confirmRemoval, isProtectedFeature } from "./removal-confirmation.ts";

function fixture(files: Readonly<Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), "cfkit-pruner-"));

  for (const [path, value] of Object.entries(files)) {
    const absolute = join(root, path);

    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
  }

  return root;
}

test("pruner: paths match the file itself or anything inside a removed directory", () => {
  assert.equal(
    isRemovedPath("src/features/billing/x.ts", [], ["src/features/billing"]),
    true,
  );
  assert.equal(
    isRemovedPath("src/features/billing", [], ["src/features/billing"]),
    true,
  );
  assert.equal(
    isRemovedPath(
      "src/features/billing-extra/x.ts",
      [],
      ["src/features/billing"],
    ),
    false,
  );
  assert.equal(
    isRemovedPath("src/features/auth/x.ts", ["src/features/auth/x.ts"], []),
    true,
  );
  assert.equal(
    isRemovedPath("src/features/auth/y.ts", ["src/features/auth/x.ts"], []),
    false,
  );
});

test("pruner: smell baseline keys for removed files go, the rest stay", () => {
  const root = fixture({
    [SMELLS_BASELINE_PATH]: {
      schemaVersion: 1,
      keys: [
        {
          key: "untracked_todo:src/features/billing/a.ts",
          ruleId: "untracked_todo",
          file: "src/features/billing/a.ts",
          reviewedOn: "2026-10-01",
        },
        {
          key: "untracked_todo:src/features/auth/b.ts",
          ruleId: "untracked_todo",
          file: "src/features/auth/b.ts",
          reviewedOn: "2026-10-01",
        },
      ],
    },
  });

  try {
    const planned = pruneBaselines(root, {
      files: [],
      directories: ["src/features/billing"],
      write: false,
    });

    assert.deepEqual(planned, [
      {
        path: SMELLS_BASELINE_PATH,
        entriesBefore: 2,
        entriesAfter: 1,
        removed: ["untracked_todo:src/features/billing/a.ts"],
        written: false,
      },
    ]);
    // A dry run changes nothing.
    assert.match(
      readFileSync(join(root, SMELLS_BASELINE_PATH), "utf8"),
      /billing\/a\.ts/,
    );

    const applied = pruneBaselines(root, {
      files: [],
      directories: ["src/features/billing"],
      write: true,
    });

    const [first] = applied;

    if (first === undefined) throw new Error("expected a prune outcome");

    assert.equal(first.written, true);

    const after = JSON.parse(
      readFileSync(join(root, SMELLS_BASELINE_PATH), "utf8"),
    ) as { keys: readonly { file: string }[] };

    assert.deepEqual(
      after.keys.map((entry) => entry.file),
      ["src/features/auth/b.ts"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pruner: allowlist pairs touching a removed path go, whole groups at a time", () => {
  const root = fixture({
    "tools/duplication-allowlist.json": {
      reviewedAcceptable: [
        { reason: "keep me", files: ["scripts/a.mjs", "scripts/b.mjs"] },
        {
          reason: "inside billing",
          files: ["src/features/billing/x.ts", "src/features/billing/y.ts"],
        },
        {
          reason: "half inside",
          files: ["src/features/billing/x.ts", "scripts/c.mjs"],
        },
      ],
    },
    "tools/small-helper-duplication-allowlist.json": { reviewedAcceptable: [] },
  });

  try {
    const outcomes = pruneBaselines(root, {
      files: ["src/features/billing/x.ts"],
      directories: ["src/features/billing"],
      write: true,
    });

    assert.equal(outcomes.length, 1);

    const [outcome] = outcomes;

    if (outcome === undefined) throw new Error("expected a prune outcome");

    assert.equal(outcome.entriesBefore, 3);
    assert.equal(outcome.entriesAfter, 1);

    const after = JSON.parse(
      readFileSync(join(root, "tools/duplication-allowlist.json"), "utf8"),
    ) as { reviewedAcceptable: readonly unknown[] };

    assert.deepEqual(after.reviewedAcceptable, [
      { reason: "keep me", files: ["scripts/a.mjs", "scripts/b.mjs"] },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pruner: a baseline with nothing to prune is left alone, and a missing one is skipped", () => {
  const root = fixture({
    [SMELLS_BASELINE_PATH]: { schemaVersion: 1, keys: [] },
  });

  try {
    assert.deepEqual(
      pruneBaselines(root, {
        files: ["unrelated.ts"],
        directories: [],
        write: true,
      }),
      [],
    );
    assert.deepEqual(
      pruneBaselines("/nonexistent-root", {
        files: [],
        directories: [],
        write: true,
      }),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("removal confirmation: features need --yes, protected features need --force-core", () => {
  assert.deepEqual(
    confirmRemoval({
      kind: "endpoint",
      target: "users.me.get",
      flags: new Set(),
    }),
    {
      ok: true,
    },
  );
  assert.deepEqual(
    confirmRemoval({ kind: "feature", target: "billing", flags: new Set() }),
    {
      ok: false,
      message:
        "[cfkit] refusing to remove a feature without --yes (nothing was changed)",
    },
  );
  assert.deepEqual(
    confirmRemoval({
      kind: "feature",
      target: "billing",
      flags: new Set(["--yes"]),
    }),
    { ok: true },
  );
  assert.deepEqual(
    confirmRemoval({
      kind: "feature",
      target: "auth",
      flags: new Set(["--yes"]),
    }),
    {
      ok: false,
      message:
        '[cfkit] refusing to remove protected core feature "auth"; pass --force-core to override',
    },
  );
  assert.deepEqual(
    confirmRemoval({
      kind: "feature",
      target: "auth",
      flags: new Set(["--yes", "--force-core"]),
    }),
    { ok: true },
  );
  assert.equal(isProtectedFeature("users"), true);
  assert.equal(isProtectedFeature("billing"), false);
});
