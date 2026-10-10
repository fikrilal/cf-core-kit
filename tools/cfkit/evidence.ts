import { readFileSync } from "node:fs";

import type { LaneName, RiskLevel } from "./risk-classifier.ts";

/**
 * The operating-evidence ledger records *reviewed* proof that a behaviour was verified in a hosted lane. It is
 * deliberately narrow: every field is an id, an enum, a hash, a revision, a URL or a date, so there is nowhere
 * for prose, prompts, customer data or PII to live. An entry that cannot be expressed in this shape is not a
 * ledger entry — it belongs in a plan, an ADR or a PR description.
 *
 * The ledger starts empty and stays advisory: eligibility (5 reviewed tasks, 2 risk classes, ≥ 1 repair or
 * escalation) gates the improvement programme (§5.8), it never blocks a change.
 */
export const LEDGER_SCHEMA_VERSION = 1;
export const LEDGER_PATH = "docs/engineering/operating-evidence-ledger.json";
export const MAX_LEDGER_BYTES = 256 * 1024;
export const TASK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const REVIEWER_PATTERN = /^[a-z0-9][a-z0-9-]{1,39}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const REVISION_PATTERN = /^[0-9a-f]{40}$/;
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const HOSTED_CI_PATTERNS: readonly RegExp[] = [
  /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/,
  /^https:\/\/gitlab\.com\/[\w./-]+\/-\/pipelines\/\d+$/,
];
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export const OUTCOMES = ["verified", "escalated"] as const;
export const LANES = [
  "fast",
  "full",
  "gates",
  "runtime",
  "smoke",
  "ci",
] as const;
export const ELIGIBILITY: Readonly<{
  reviewedTasks: number;
  riskClasses: number;
  repairOrEscalation: number;
}> = { reviewedTasks: 5, riskClasses: 2, repairOrEscalation: 1 };

export type LedgerOutcome = (typeof OUTCOMES)[number];

export type LedgerEntry = Readonly<{
  taskId: string;
  risk: RiskLevel;
  lane: LaneName;
  outcome: LedgerOutcome;
  attempts: number;
  repairs: number;
  escalations: number;
  episodeHash: string;
  revision: string;
  ciRunUrl: string;
  reviewedBy: string;
  reviewedOn: string;
}>;

export type Ledger = Readonly<{
  schemaVersion: number;
  entries: readonly LedgerEntry[];
}>;

export const ENTRY_KEYS: readonly (keyof LedgerEntry)[] = [
  "taskId",
  "risk",
  "lane",
  "outcome",
  "attempts",
  "repairs",
  "escalations",
  "episodeHash",
  "revision",
  "ciRunUrl",
  "reviewedBy",
  "reviewedOn",
];

export function parseLedger(source: string): Ledger {
  return JSON.parse(source) as Ledger;
}

export function readLedger(root: string): Ledger {
  const source = readFileSync(`${root}/${LEDGER_PATH}`, "utf8");

  return parseLedger(source);
}

function isMember(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === "string" && allowed.includes(value);
}

function formatProblems(entry: Record<string, unknown>, at: string): string[] {
  const problems: string[] = [];

  if (typeof entry.taskId !== "string" || !TASK_ID_PATTERN.test(entry.taskId)) {
    problems.push(`${at}.taskId must be kebab-case (3-80 characters)`);
  }
  if (
    typeof entry.reviewedBy !== "string" ||
    !REVIEWER_PATTERN.test(entry.reviewedBy)
  ) {
    problems.push(
      `${at}.reviewedBy must be a short handle (not a name, not an address)`,
    );
  }
  if (
    typeof entry.ciRunUrl !== "string" ||
    !HOSTED_CI_PATTERNS.some((pattern) => pattern.test(String(entry.ciRunUrl)))
  ) {
    problems.push(
      `${at}.ciRunUrl must be a GitHub Actions or GitLab pipeline run URL`,
    );
  }

  return problems;
}

function enumProblems(entry: Record<string, unknown>, at: string): string[] {
  const problems: string[] = [];

  if (!isMember(entry.risk, RISK_LEVELS)) {
    problems.push(`${at}.risk must be low|medium|high`);
  }
  if (!isMember(entry.lane, LANES)) {
    problems.push(`${at}.lane must be fast|full|gates|runtime|smoke|ci`);
  }
  if (!isMember(entry.outcome, OUTCOMES)) {
    problems.push(`${at}.outcome must be verified|escalated`);
  }

  return problems;
}

function patternProblems(entry: Record<string, unknown>, at: string): string[] {
  return [...formatProblems(entry, at), ...enumProblems(entry, at)];
}

function hashProblems(entry: Record<string, unknown>, at: string): string[] {
  const problems: string[] = [];

  if (
    typeof entry.episodeHash !== "string" ||
    !SHA256_PATTERN.test(entry.episodeHash)
  ) {
    problems.push(
      `${at}.episodeHash must be a sha256 hex digest of the episode`,
    );
  }
  if (
    typeof entry.revision !== "string" ||
    !REVISION_PATTERN.test(entry.revision)
  ) {
    problems.push(`${at}.revision must be a 40-character revision`);
  }
  if (
    typeof entry.reviewedOn !== "string" ||
    !DATE_PATTERN.test(entry.reviewedOn)
  ) {
    problems.push(`${at}.reviewedOn must be YYYY-MM-DD`);
  }

  return problems;
}

function countProblems(entry: Record<string, unknown>, at: string): string[] {
  const problems: string[] = [];
  const counts = [entry.attempts, entry.repairs, entry.escalations];
  const invalid = counts.some(
    (value) =>
      typeof value !== "number" || !Number.isInteger(value) || value < 0,
  );

  if (invalid) {
    return [`${at}.attempts/repairs/escalations must be non-negative integers`];
  }

  const attempts = Number(entry.attempts);
  const escalations = Number(entry.escalations);

  if (attempts === 0) {
    problems.push(`${at}.attempts must be at least 1`);
  } else if (escalations > attempts) {
    problems.push(`${at}.escalations cannot exceed attempts`);
  } else if (entry.outcome === "escalated" && escalations === 0) {
    problems.push(`${at}.outcome "escalated" needs at least one escalation`);
  }

  return problems;
}

function keyProblems(entry: Record<string, unknown>, index: number): string[] {
  const at = `entries[${String(index)}]`;
  const problems: string[] = [];

  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.includes(key as keyof LedgerEntry)) {
      problems.push(
        `${at}.${key} is not a ledger field (no prose belongs here)`,
      );
    }
  }

  // PII guard: the schema admits no free text, so any address-like value is a schema escape.
  for (const value of Object.values(entry)) {
    if (typeof value === "string" && /@|\n/.test(value)) {
      problems.push(`${at} contains an address or a line break`);
    }
  }

  return problems;
}

export function validateLedger(ledger: unknown, bytes?: number): string[] {
  const problems: string[] = [];
  const record = ledger as Partial<Ledger> | null;

  if (bytes !== undefined && bytes > MAX_LEDGER_BYTES) {
    problems.push(
      `ledger is ${String(bytes)} bytes; the cap is ${String(MAX_LEDGER_BYTES)}`,
    );
  }
  if (record === null || typeof record !== "object") {
    return [...problems, "ledger must be an object"];
  }
  if (record.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    return [
      ...problems,
      `schemaVersion must be ${String(LEDGER_SCHEMA_VERSION)}`,
    ];
  }
  if (!Array.isArray(record.entries)) {
    return [...problems, "entries must be an array"];
  }

  const seen = new Set<string>();

  record.entries.forEach((raw, index) => {
    const entry = raw as Record<string, unknown>;
    const at = `entries[${String(index)}]`;

    problems.push(
      ...keyProblems(entry, index),
      ...patternProblems(entry, at),
      ...hashProblems(entry, at),
      ...countProblems(entry, at),
    );

    const taskId = entry.taskId;

    if (typeof taskId === "string") {
      if (seen.has(taskId)) problems.push(`${at}.taskId is already recorded`);
      seen.add(taskId);
    }
  });

  return problems;
}

export function eligibilityShortfall(
  entries: readonly LedgerEntry[],
): readonly string[] {
  const reviewedTasks = new Set(entries.map((entry) => entry.taskId)).size;
  const riskClasses = new Set(entries.map((entry) => entry.risk)).size;
  const repairs = entries.filter(
    (entry) => entry.repairs >= 1 || entry.escalations >= 1,
  ).length;
  const shortfall: string[] = [];

  if (reviewedTasks < ELIGIBILITY.reviewedTasks) {
    shortfall.push(
      `${String(ELIGIBILITY.reviewedTasks - reviewedTasks)} more reviewed tasks (${String(reviewedTasks)}/${String(ELIGIBILITY.reviewedTasks)})`,
    );
  }
  if (riskClasses < ELIGIBILITY.riskClasses) {
    shortfall.push(
      `${String(ELIGIBILITY.riskClasses - riskClasses)} more risk classes (${String(riskClasses)}/${String(ELIGIBILITY.riskClasses)})`,
    );
  }
  if (repairs < ELIGIBILITY.repairOrEscalation) {
    shortfall.push("no repair or escalation recorded yet");
  }

  return shortfall;
}

export function formatLedgerReport(ledger: Ledger): string {
  const shortfall = eligibilityShortfall(ledger.entries);

  return [
    `[evidence] entries ${String(ledger.entries.length)}; eligible ${shortfall.length === 0 ? "yes" : "no"}`,
    ...shortfall.map((item) => `[evidence] shortfall: ${item}`),
  ].join("\n");
}
