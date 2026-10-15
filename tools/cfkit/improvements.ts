import { existsSync, readFileSync } from "node:fs";

import { eligibilityShortfall, readLedger } from "./evidence.ts";

/**
 * The improvement programme, ported with its **gating** rather than its optimism: a ledger of proposals and the
 * invariants they must satisfy, disabled until the operating-evidence ledger is eligible. `check` validates the
 * machinery; `analyze` and `shadow` refuse while the gate is closed — which is the honest state of a programme
 * that has no reviewed operating evidence yet.
 */
export const IMPROVEMENT_LEDGER_PATH =
  "docs/engineering/improvements-ledger.json";
export const IMPROVEMENT_SCHEMA_VERSION = 1;
export const IMPROVEMENT_STATUSES = [
  "proposed",
  "approved",
  "evaluating",
  "kept",
  "reverted",
] as const;
export const IMPROVEMENT_INVARIANTS = [
  "authority.no-expansion",
  "evidence.no-sensitive-data",
  "publication.no-expansion",
  "risk.no-lowering",
  "verification.no-weakening",
] as const;
/** Where an improvement may edit: the harness, never the product surface. */
export const IMPROVEMENT_ALLOWED_PATHS = [
  "tools/cfkit/**",
  "scripts/**",
  "docs/engineering/**",
  "docs/adr/**",
  "docs/exec-plans/**",
  ".github/workflows/**",
  "package.json",
  "package-lock.json",
] as const;
export const IMPROVEMENT_AUTHORITY = ["edit", "verify"] as const;

export type ImprovementStatus = (typeof IMPROVEMENT_STATUSES)[number];

export type ImprovementEntry = Readonly<{
  id: string;
  status: ImprovementStatus;
  owner: string;
  approver: string;
  invariants: readonly string[];
  paths: readonly string[];
  proposedOn: string;
  evaluatedOn?: string;
  outcome?: string;
}>;

export type ImprovementLedger = Readonly<{
  schemaVersion: number;
  entries: readonly ImprovementEntry[];
}>;

export function readImprovementLedger(root: string): ImprovementLedger {
  const path = `${root}/${IMPROVEMENT_LEDGER_PATH}`;

  return JSON.parse(readFileSync(path, "utf8")) as ImprovementLedger;
}

function coveredBy(path: string, allowed: readonly string[]): boolean {
  return allowed.some((entry) => {
    const prefix = entry.replace("/**", "").replace("/*", "");

    return entry.endsWith("**") || entry.endsWith("*")
      ? path.startsWith(prefix)
      : path === entry;
  });
}

function entryProblems(
  entry: Record<string, unknown>,
  index: number,
): readonly string[] {
  const at = `entries[${String(index)}]`;
  const problems: string[] = [];
  const status = entry.status;

  if (typeof entry.id !== "string" || entry.id === "") {
    problems.push(`${at}.id is required`);
  }
  if (
    typeof status !== "string" ||
    !IMPROVEMENT_STATUSES.includes(
      status as (typeof IMPROVEMENT_STATUSES)[number],
    )
  ) {
    problems.push(`${at}.status must be ${IMPROVEMENT_STATUSES.join("|")}`);
  }
  if (typeof entry.owner !== "string" || entry.owner === "") {
    problems.push(`${at}.owner is required`);
  }
  // An improvement cannot approve itself.
  if (
    typeof entry.approver !== "string" ||
    entry.approver === "" ||
    entry.approver === entry.owner
  ) {
    problems.push(`${at}.approver must be someone other than the owner`);
  }
  return [...problems, ...evaluationProblems(entry, status, at)];
}

/** A kept or reverted improvement must say when it was compared. */
function evaluationProblems(
  entry: Record<string, unknown>,
  status: unknown,
  at: string,
): readonly string[] {
  if (status !== "kept" && status !== "reverted") return [];
  if (entry.evaluatedOn !== undefined) return [];

  return [
    `${at}.evaluatedOn is required once an improvement is kept or reverted`,
  ];
}

function surfaceProblems(
  entry: Record<string, unknown>,
  index: number,
): readonly string[] {
  const at = `entries[${String(index)}]`;
  const invariants = Array.isArray(entry.invariants) ? entry.invariants : [];
  const paths = Array.isArray(entry.paths) ? entry.paths : [];
  const problems: string[] = [];

  for (const invariant of invariants) {
    if (
      typeof invariant !== "string" ||
      !IMPROVEMENT_INVARIANTS.includes(
        invariant as (typeof IMPROVEMENT_INVARIANTS)[number],
      )
    ) {
      problems.push(
        `${at}.invariants: unknown invariant "${String(invariant)}"`,
      );
    }
  }

  for (const path of paths) {
    if (
      typeof path !== "string" ||
      !coveredBy(path, IMPROVEMENT_ALLOWED_PATHS)
    ) {
      problems.push(
        `${at}.paths: "${String(path)}" is outside the improvement surface`,
      );
    }
  }

  return problems;
}

export function validateImprovementLedger(ledger: unknown): readonly string[] {
  const record = ledger as Partial<ImprovementLedger> | null;

  if (record === null || typeof record !== "object") {
    return ["ledger must be an object"];
  }
  if (record.schemaVersion !== IMPROVEMENT_SCHEMA_VERSION) {
    return [`schemaVersion must be ${String(IMPROVEMENT_SCHEMA_VERSION)}`];
  }
  if (!Array.isArray(record.entries)) return ["entries must be an array"];

  const problems: string[] = [];
  const seen = new Set<string>();

  (record.entries as unknown[]).forEach((raw, index) => {
    const entry = raw as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : "";

    if (seen.has(id)) {
      problems.push(`entries[${String(index)}].id is already recorded`);
    }
    seen.add(id);

    problems.push(
      ...entryProblems(entry, index),
      ...surfaceProblems(entry, index),
    );
  });

  return problems;
}

/** The gate: an improvement programme needs reviewed operating evidence before it may propose anything. */
export function improvementEligibility(
  root: string,
): Readonly<{ eligible: boolean; shortfall: readonly string[] }> {
  const shortfall = eligibilityShortfall(readLedger(root).entries);

  return { eligible: shortfall.length === 0, shortfall };
}

export function formatImprovementReport(
  ledger: ImprovementLedger,
  eligibility: Readonly<{ eligible: boolean; shortfall: readonly string[] }>,
): string {
  const lines = [
    `[improve] entries ${String(ledger.entries.length)}; eligible ${eligibility.eligible ? "yes" : "no"}`,
    `[improve] authority ${IMPROVEMENT_AUTHORITY.join(", ")}; surface ${String(IMPROVEMENT_ALLOWED_PATHS.length)} path rules`,
  ];

  for (const item of eligibility.shortfall) {
    lines.push(`[improve] ineligible: ${item}`);
  }

  return lines.join("\n");
}

export function improvementLedgerExists(root: string): boolean {
  return existsSync(`${root}/${IMPROVEMENT_LEDGER_PATH}`);
}
