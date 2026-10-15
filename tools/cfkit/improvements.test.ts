import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatImprovementReport,
  improvementEligibility,
  IMPROVEMENT_ALLOWED_PATHS,
  IMPROVEMENT_AUTHORITY,
  readImprovementLedger,
  validateImprovementLedger,
  type ImprovementEntry,
} from "./improvements.ts";

function entry(overrides: Partial<ImprovementEntry> = {}): ImprovementEntry {
  return {
    id: "faster-fixtures",
    status: "proposed",
    owner: "fikrilal",
    approver: "reviewer-one",
    invariants: ["verification.no-weakening"],
    paths: ["tools/cfkit/**"],
    proposedOn: "2026-10-14",
    ...overrides,
  };
}

test("improvements: the shipped ledger is valid, empty and ineligible", () => {
  const ledger = readImprovementLedger(process.cwd());

  assert.deepEqual(ledger.entries, []);
  assert.deepEqual(validateImprovementLedger(ledger), []);

  const eligibility = improvementEligibility(process.cwd());

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.shortfall.length, 3);
  assert.match(
    formatImprovementReport(ledger, eligibility),
    /entries 0; eligible no/,
  );
});

test("improvements: an entry validates, and the approver may not be the owner", () => {
  assert.deepEqual(
    validateImprovementLedger({ schemaVersion: 1, entries: [entry()] }),
    [],
  );

  const problems = validateImprovementLedger({
    schemaVersion: 1,
    entries: [entry({ approver: "fikrilal" })],
  });

  assert.deepEqual(problems, [
    "entries[0].approver must be someone other than the owner",
  ]);
});

test("improvements: statuses, invariants and the surface are enforced", () => {
  const cases: readonly [Partial<ImprovementEntry>, RegExp][] = [
    [
      { status: "maybe" as ImprovementEntry["status"] },
      /status must be proposed/,
    ],
    [
      { invariants: ["authority.whatever"] },
      /unknown invariant "authority.whatever"/,
    ],
    [{ paths: ["src/features/auth/a.ts"] }, /outside the improvement surface/],
    [
      { paths: ["docs/standards/testing-strategy.md"] },
      /outside the improvement surface/,
    ],
    [{ status: "kept" }, /evaluatedOn is required/],
    [{ id: "" }, /id is required/],
  ];

  for (const [overrides, pattern] of cases) {
    const problems = validateImprovementLedger({
      schemaVersion: 1,
      entries: [entry(overrides)],
    });

    assert.ok(
      problems.some((problem) => pattern.test(problem)),
      `${JSON.stringify(overrides)} must be refused`,
    );
  }

  assert.deepEqual(
    validateImprovementLedger({
      schemaVersion: 1,
      entries: [entry({ id: "twice" }), entry({ id: "twice" })],
    }),
    ["entries[1].id is already recorded"],
  );
  assert.deepEqual(
    validateImprovementLedger({ schemaVersion: 2, entries: [] }),
    ["schemaVersion must be 1"],
  );
  assert.deepEqual(validateImprovementLedger({ schemaVersion: 1 }), [
    "entries must be an array",
  ]);
  assert.deepEqual(validateImprovementLedger(null), [
    "ledger must be an object",
  ]);
});

test("improvements: the surface and the authority are the declared ones", () => {
  assert.deepEqual([...IMPROVEMENT_AUTHORITY], ["edit", "verify"]);
  assert.ok(IMPROVEMENT_ALLOWED_PATHS.includes("tools/cfkit/**"));
  assert.ok(IMPROVEMENT_ALLOWED_PATHS.includes("package.json"));
  assert.ok(!IMPROVEMENT_ALLOWED_PATHS.some((path) => path.startsWith("src/")));

  // A kept improvement with an evaluation date is valid.
  assert.deepEqual(
    validateImprovementLedger({
      schemaVersion: 1,
      entries: [
        entry({ status: "evaluating" }),
        entry({
          id: "kept-one",
          status: "kept",
          evaluatedOn: "2026-10-20",
          outcome: "better",
        }),
      ],
    }),
    [],
  );
});
