import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { FailureDescriptor } from "./failure-taxonomy.ts";
import type { LaneName } from "./risk-classifier.ts";

/**
 * Episodes are the harness's memory of what an attempt did, and they are *structured*: ids, exit codes,
 * durations and a single sanitized line per failure. Nothing else may appear — a forbidden key anywhere in
 * the document (prompt, reasoning, stdout, stderr, environment, credential, token, cookie, requestBody,
 * databaseUrl) is a validation failure, because an episode that leaks one of those is worse than no episode.
 */
export const EPISODE_SCHEMA_VERSION = 1;
export const FORBIDDEN_EPISODE_KEYS =
  /prompt|reasoning|stdout|stderr|environment|credential|token|cookie|requestBody|databaseUrl/i;
export const DIAGNOSTICS_LIMIT_BYTES = 16 * 1024;
export const TRUNCATION_MARKER = "[TRUNCATED]\n";
export const MAX_FIRST_LINE_LENGTH = 200;
export const PRIVATE_DIRECTORY_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export type EpisodeStep = Readonly<{
  id: string;
  status: "passed" | "failed";
  exitCode: number;
  durationMs: number;
  failure?: Readonly<{
    code: string;
    repairable: boolean;
    firstLine: string;
  }>;
}>;

export type Episode = Readonly<{
  schemaVersion: number;
  taskId: string;
  attempt: number;
  lane: LaneName;
  outcome: "verified" | "failed";
  durationMs: number;
  steps: readonly EpisodeStep[];
}>;

/**
 * The redaction table the diagnostics writer applies. Every pattern here has met a real leak candidate:
 * provider keys and JWTs from logs, signed-URL signatures, secret assignments from error banners, and
 * addresses from rows printed by a failing SQL statement.
 */
export const REDACTIONS: readonly Readonly<{
  pattern: RegExp;
  replacement: string;
}>[] = [
  {
    pattern: /(authorization\s*:\s*bearer\s+)[^\s"']+/gi,
    replacement: "$1<redacted>",
  },
  {
    pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/gi,
    replacement: "Bearer <redacted>",
  },
  { pattern: /(x-amz-signature=)[^&\s"']+/gi, replacement: "$1<redacted>" },
  { pattern: /(x-amz-credential=)[^&\s"']+/gi, replacement: "$1<redacted>" },
  { pattern: /\b(?:re|sk|pk)_[A-Za-z0-9]{12,}\b/g, replacement: "<redacted>" },
  { pattern: /\beyJ[A-Za-z0-9._-]{24,}\b/g, replacement: "<redacted>" },
  {
    pattern:
      /\b(AUTH_SIGNING_KEYS_JSON|AUTH_SIGNING_KEYS_JSON_BASE64|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID|RESEND_API_KEY|PUSH_PROVIDER)\s*[:=]\s*[^\s,;"']+/g,
    replacement: "$1=<redacted>",
  },
  {
    pattern: /"d"\s*:\s*"[A-Za-z0-9_-]{20,}"/g,
    replacement: '"d":"<redacted>"',
  },
  {
    pattern: /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/g,
    replacement: "user-<redacted>@example.com",
  },
];

export function sanitizeDiagnostics(text: string): string {
  let sanitized = text;

  for (const { pattern, replacement } of REDACTIONS) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  return sanitized;
}

/** Tail-kept: the end of a log carries the failure; the start carries setup noise. */
export function capDiagnostics(text: string): string {
  const bytes = Buffer.byteLength(text, "utf8");

  if (bytes <= DIAGNOSTICS_LIMIT_BYTES) return text;

  const budget =
    DIAGNOSTICS_LIMIT_BYTES - Buffer.byteLength(TRUNCATION_MARKER, "utf8");
  const tail = Buffer.from(text, "utf8").subarray(-budget).toString("utf8");

  return `${TRUNCATION_MARKER}${tail}`;
}

export const FAILURE_LINE_PATTERN = /(^|\s)(error|failed|not ok|x |✗)/i;

/** The line an episode should remember: the first failure-looking line, else the first line at all. */
export function firstFailingLine(output: string): string {
  const lines = sanitizeDiagnostics(output)
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  const line =
    lines.find((entry) => FAILURE_LINE_PATTERN.test(entry)) ?? lines[0] ?? "";

  return line.slice(0, MAX_FIRST_LINE_LENGTH);
}

/** Writes atomically under a 0700 directory with 0600 permissions. */
export function writePrivateArtifact(path: string, content: string): void {
  const directory = path.slice(0, path.lastIndexOf("/"));

  mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  chmodSync(directory, PRIVATE_DIRECTORY_MODE);

  const temporary = `${path}.tmp`;

  writeFileSync(temporary, content, { mode: PRIVATE_FILE_MODE });
  chmodSync(temporary, PRIVATE_FILE_MODE);
  renameSync(temporary, path);
  chmodSync(path, PRIVATE_FILE_MODE);
}

function forbiddenKeyProblems(value: unknown, path: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      forbiddenKeyProblems(entry, `${path}[${String(index)}]`),
    );
  }
  if (typeof value !== "object" || value === null) return [];

  const problems: string[] = [];

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_EPISODE_KEYS.test(key)) {
      problems.push(`${path}.${key}: forbidden key`);
    }

    problems.push(...forbiddenKeyProblems(entry, `${path}.${key}`));
  }

  return problems;
}

function stepProblems(steps: unknown): string[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    return ["steps must be a non-empty array"];
  }

  const problems: string[] = [];

  for (const step of steps) {
    const entry = step as Partial<EpisodeStep>;

    if (typeof entry.id !== "string" || entry.id === "") {
      problems.push("every step needs an id");
    }
    if (entry.status !== "passed" && entry.status !== "failed") {
      problems.push(`step ${String(entry.id)} needs a status`);
    }
    if (typeof entry.exitCode !== "number") {
      problems.push(`step ${String(entry.id)} needs an exit code`);
    }
  }

  return problems;
}

function shapeProblems(record: Record<string, unknown>): string[] {
  const problems: string[] = [];

  if (record.schemaVersion !== EPISODE_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${String(EPISODE_SCHEMA_VERSION)}`);
  }
  if (typeof record.taskId !== "string" || record.taskId === "") {
    problems.push("taskId must be a non-empty string");
  }
  if (typeof record.attempt !== "number" || record.attempt < 1) {
    problems.push("attempt must be a positive number");
  }
  if (record.outcome !== "verified" && record.outcome !== "failed") {
    problems.push('outcome must be "verified" or "failed"');
  }

  return [...problems, ...stepProblems(record.steps)];
}

export function validateEpisode(episode: unknown): string[] {
  const problems = forbiddenKeyProblems(episode, "episode");

  if (typeof episode !== "object" || episode === null) {
    return [...problems, "episode must be an object"];
  }

  return [...problems, ...shapeProblems(episode as Record<string, unknown>)];
}

export type AttemptInput = Readonly<{
  taskId: string;
  attempt: number;
  lane: LaneName;
  durationMs: number;
  steps: readonly Readonly<{
    id: string;
    status: "passed" | "failed";
    exitCode: number;
    durationMs: number;
    descriptor?: FailureDescriptor;
    output?: string;
  }>[];
}>;

export function buildEpisode(input: AttemptInput): Episode {
  const outcome = input.steps.some((step) => step.status === "failed")
    ? "failed"
    : "verified";

  return {
    schemaVersion: EPISODE_SCHEMA_VERSION,
    taskId: input.taskId,
    attempt: input.attempt,
    lane: input.lane,
    outcome,
    durationMs: input.durationMs,
    steps: input.steps.map((step) => ({
      id: step.id,
      status: step.status,
      exitCode: step.exitCode,
      durationMs: step.durationMs,
      ...(step.status === "failed"
        ? {
            failure: {
              code: step.descriptor?.code ?? "harness.unknown-step",
              repairable: step.descriptor?.repairable ?? false,
              firstLine: firstFailingLine(step.output ?? ""),
            },
          }
        : {}),
    })),
  };
}

export function renderDiagnostics(input: AttemptInput): string {
  const episode = buildEpisode(input);
  const lines = [
    `[cfkit] task ${input.taskId} attempt ${String(input.attempt)} lane ${input.lane} outcome ${episode.outcome}`,
  ];

  for (const step of input.steps) {
    lines.push(
      `step ${step.id} ${step.status} (${(step.durationMs / 1000).toFixed(1)}s) exit ${String(step.exitCode)}`,
    );
  }

  for (const step of input.steps) {
    if (step.status !== "failed" || (step.output ?? "") === "") continue;

    lines.push(
      `--- ${step.id} output (sanitized) ---`,
      sanitizeDiagnostics(step.output ?? ""),
    );
  }

  return capDiagnostics(lines.join("\n"));
}

export type RecordedAttempt = Readonly<{
  episodePath: string;
  diagnosticsPath: string;
  episode: Episode;
}>;

export function recordAttempt(
  root: string,
  input: AttemptInput,
): RecordedAttempt {
  const episode = buildEpisode(input);
  const problems = validateEpisode(episode);

  if (problems.length > 0) {
    throw new Error(`episode validation failed: ${problems.join("; ")}`);
  }

  const directory = join(root, ".cfkit", "tasks", input.taskId);
  const episodePath = join(
    directory,
    "episodes",
    `attempt-${String(input.attempt)}.json`,
  );
  const diagnosticsPath = join(
    directory,
    "diagnostics",
    `attempt-${String(input.attempt)}.txt`,
  );

  writePrivateArtifact(episodePath, `${JSON.stringify(episode, null, 2)}\n`);
  writePrivateArtifact(diagnosticsPath, renderDiagnostics(input));

  return { episodePath, diagnosticsPath, episode };
}
