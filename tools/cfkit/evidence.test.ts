import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ELIGIBILITY,
  eligibilityShortfall,
  formatLedgerReport,
  LEDGER_PATH,
  LEDGER_SCHEMA_VERSION,
  MAX_LEDGER_BYTES,
  readLedger,
  validateLedger,
  type LedgerEntry,
} from "./evidence.ts";

const ROOT = process.cwd();

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    taskId: "sample-task",
    risk: "medium",
    lane: "ci",
    outcome: "verified",
    attempts: 1,
    repairs: 0,
    escalations: 0,
    episodeHash: "a".repeat(64),
    revision: "b".repeat(40),
    ciRunUrl: "https://github.com/example/repo/actions/runs/123456",
    reviewedBy: "reviewer-one",
    reviewedOn: "2026-10-13",
    ...overrides,
  };
}

function ledger(
  entries: readonly unknown[],
  schemaVersion = LEDGER_SCHEMA_VERSION,
) {
  return { schemaVersion, entries };
}

test("evidence: the shipped ledger is valid, empty and inside the cap", () => {
  const source = readFileSync(join(ROOT, LEDGER_PATH), "utf8");
  const parsed: unknown = JSON.parse(source);

  assert.deepEqual(
    validateLedger(parsed, Buffer.byteLength(source, "utf8")),
    [],
  );
  assert.deepEqual(readLedger(ROOT).entries, []);
});

test("evidence: a complete entry validates", () => {
  assert.deepEqual(validateLedger(ledger([entry()])), []);
  assert.deepEqual(
    validateLedger(
      ledger([
        entry({
          outcome: "escalated",
          escalations: 1,
          repairs: 2,
          attempts: 3,
        }),
        entry({
          taskId: "other-task",
          ciRunUrl: "https://gitlab.com/group/project/-/pipelines/987",
        }),
      ]),
    ),
    [],
  );
});

test("evidence: unknown fields are rejected — the schema has no prose", () => {
  const problems = validateLedger(
    ledger([{ ...entry(), notes: "the run looked fine, talked to Sam" }]),
  );

  assert.deepEqual(problems, [
    "entries[0].notes is not a ledger field (no prose belongs here)",
  ]);
});

test("evidence: addresses and line breaks are rejected anywhere", () => {
  assert.deepEqual(
    validateLedger(
      ledger([{ ...entry(), reviewedBy: "sam@example.com" }]),
    ).filter((problem) => problem.includes("address or a line break")),
    ["entries[0] contains an address or a line break"],
  );
  assert.deepEqual(
    validateLedger(ledger([entry({ reviewedBy: "reviewer-one" })])).length,
    0,
  );
});

test("evidence: hashes, revisions and dates are shape-checked", () => {
  const cases: readonly [Partial<LedgerEntry>, RegExp][] = [
    [{ episodeHash: "abc" }, /episodeHash must be a sha256/],
    [{ episodeHash: "A".repeat(64) }, /episodeHash must be a sha256/],
    [{ revision: "b".repeat(39) }, /revision must be a 40-character/],
    [{ reviewedOn: "13-10-2026" }, /reviewedOn must be YYYY-MM-DD/],
    [
      { ciRunUrl: "https://example.com/run/1" },
      /must be a GitHub Actions or GitLab pipeline run URL/,
    ],
    [
      { outcome: "maybe" as LedgerEntry["outcome"] },
      /outcome must be verified\|escalated/,
    ],
    [{ lane: "nightly" as LedgerEntry["lane"] }, /lane must be fast\|full/],
    [
      { risk: "critical" as LedgerEntry["risk"] },
      /risk must be low\|medium\|high/,
    ],
    [{ reviewedBy: "Sam Smith" }, /reviewedBy must be a short handle/],
  ];

  for (const [overrides, pattern] of cases) {
    const problems = validateLedger(ledger([entry(overrides)]));

    assert.ok(
      problems.some((problem) => pattern.test(problem)),
      `${JSON.stringify(overrides)} must be rejected`,
    );
  }
});

test("evidence: attempts and escalations are consistent", () => {
  assert.deepEqual(validateLedger(ledger([entry({ attempts: 0 })])), [
    "entries[0].attempts must be at least 1",
  ]);
  assert.deepEqual(
    validateLedger(ledger([entry({ attempts: 1, escalations: 2 })])),
    ["entries[0].escalations cannot exceed attempts"],
  );
  assert.deepEqual(validateLedger(ledger([entry({ outcome: "escalated" })])), [
    'entries[0].outcome "escalated" needs at least one escalation',
  ]);
  assert.deepEqual(validateLedger(ledger([entry({ repairs: -1 })])), [
    "entries[0].attempts/repairs/escalations must be non-negative integers",
  ]);
});

test("evidence: task ids are unique", () => {
  assert.deepEqual(validateLedger(ledger([entry(), entry()])), [
    "entries[1].taskId is already recorded",
  ]);
});

test("evidence: the schema version and the size cap are enforced", () => {
  assert.deepEqual(validateLedger({ schemaVersion: 2, entries: [] }), [
    "schemaVersion must be 1",
  ]);
  assert.deepEqual(validateLedger({ schemaVersion: 1 }), [
    "entries must be an array",
  ]);
  assert.deepEqual(validateLedger(null), ["ledger must be an object"]);
  assert.deepEqual(validateLedger(ledger([]), MAX_LEDGER_BYTES + 1), [
    `ledger is ${String(MAX_LEDGER_BYTES + 1)} bytes; the cap is ${String(MAX_LEDGER_BYTES)}`,
  ]);
});

test("evidence: eligibility reports the shortfall and clears when satisfied", () => {
  const empty = eligibilityShortfall([]);

  assert.equal(empty.length, 3);
  assert.match(empty[0] ?? "", /5 more reviewed tasks \(0\/5\)/);

  const satisfied = [
    entry({ taskId: "t1", risk: "low", repairs: 1 }),
    entry({ taskId: "t2", risk: "low" }),
    entry({ taskId: "t3", risk: "high" }),
    entry({ taskId: "t4", risk: "high" }),
    entry({ taskId: "t5", risk: "medium" }),
  ];

  assert.deepEqual(eligibilityShortfall(satisfied), []);
  assert.match(
    formatLedgerReport({
      schemaVersion: LEDGER_SCHEMA_VERSION,
      entries: satisfied,
    }),
    /entries 5; eligible yes/,
  );
  assert.match(
    formatLedgerReport({ schemaVersion: 1, entries: [] }),
    /shortfall: 5 more reviewed tasks/,
  );
  assert.equal(ELIGIBILITY.riskClasses, 2);
});
