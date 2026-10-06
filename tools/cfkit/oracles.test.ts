import assert from "node:assert/strict";
import { test } from "node:test";

import {
  END_TO_END_EVIDENCE_PREFIXES,
  isEndToEndEvidence,
  ORACLES,
  ORACLE_ID_PATTERN,
  formatOracleReport,
  oracleSummary,
  validateOracles,
  type Oracle,
} from "./oracles.ts";

const ROOT = process.cwd();

function oracle(overrides: Partial<Oracle> = {}): Oracle {
  return {
    id: "sample.behaviour",
    acceptance:
      "The behaviour is asserted end to end, including its failure direction.",
    status: "covered",
    evidence: ["test/integration/refresh-rotation.spec.ts"],
    ...overrides,
  };
}

test("oracles: the shipped registry validates against the repository", () => {
  assert.deepEqual(validateOracles(ORACLES, ROOT), []);

  const ids = ORACLES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");

  for (const entry of ORACLES) {
    assert.ok(ORACLE_ID_PATTERN.test(entry.id), entry.id);
    assert.ok(END_TO_END_EVIDENCE_PREFIXES.length > 0);
  }
});

test("oracles: covered entries cite end-to-end evidence, pending entries explain the gap", () => {
  const summary = oracleSummary(ORACLES);

  assert.equal(summary.covered + summary.pending, ORACLES.length);
  assert.ok(summary.covered >= 4, "the registry must not be all-pending");

  for (const entry of ORACLES) {
    if (entry.status === "covered") {
      assert.ok(
        entry.evidence.some((path) => isEndToEndEvidence(path)),
        `${entry.id} is covered without end-to-end evidence`,
      );
    } else {
      assert.ok(
        (entry.reason ?? "").length >= 20,
        `${entry.id} needs a reason`,
      );
    }
  }
});

test("oracles: the validator rejects each malformed shape", () => {
  const cases: readonly [string, Oracle][] = [
    ["bad id", oracle({ id: "Bad_Id" })],
    [
      "short acceptance",
      oracle({ id: "short.acceptance", acceptance: "too short" }),
    ],
    ["no evidence", oracle({ id: "no.evidence", evidence: [] })],
    [
      "missing evidence file",
      oracle({
        id: "missing.file",
        evidence: ["test/integration/nope.spec.ts"],
      }),
    ],
    [
      "unit-only evidence marked covered",
      oracle({
        id: "unit.only",
        evidence: ["src/features/auth/sessions/refresh.spec.ts"],
      }),
    ],
    [
      "pending without a reason",
      oracle({
        id: "pending.no-reason",
        status: "pending",
        evidence: ["src/features/auth/sessions/refresh.spec.ts"],
        reason: "",
      }),
    ],
  ];

  for (const [label, entry] of cases) {
    assert.ok(
      validateOracles([entry], ROOT).length > 0,
      `${label} must be rejected`,
    );
  }

  assert.deepEqual(
    validateOracles(
      [oracle({ id: "twice" }), oracle({ id: "twice" })],
      ROOT,
    ).filter((problem) => problem.includes("duplicate")),
    ["twice: duplicate id"],
  );
});

test("oracles: the report names every pending gap", () => {
  const report = formatOracleReport(ORACLES);
  const summary = oracleSummary(ORACLES);

  assert.match(
    report,
    new RegExp(
      `covered ${String(summary.covered)}, pending ${String(summary.pending)}`,
    ),
  );

  for (const id of summary.pendingIds) {
    assert.ok(report.includes(id), `${id} must be printed`);
  }
});
