import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The oracle registry: for every high-risk behaviour, where the *end-to-end* proof lives. A `covered`
 * oracle must cite at least one file under `test/integration/**` or `test/contract/**` — a single-feature
 * spec is structurally ineligible, because the claim being made is that the whole surface runs together.
 *
 * `pending` oracles are not hidden: they carry the strongest evidence we have today plus the reason it is
 * not yet end-to-end, and they are printed on every check so the gap stays visible (ADR-0011).
 */
export const ORACLE_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;
export const MIN_ACCEPTANCE_LENGTH = 20;
export const MIN_REASON_LENGTH = 20;
export const END_TO_END_EVIDENCE_PREFIXES = [
  "test/integration/",
  "test/contract/",
];

export type OracleStatus = "covered" | "pending";

export type Oracle = Readonly<{
  id: string;
  acceptance: string;
  status: OracleStatus;
  evidence: readonly string[];
  reason?: string;
}>;

export const ORACLES: readonly Oracle[] = [
  {
    id: "auth.refresh-rotation",
    acceptance:
      "A refresh token rotates exactly once; presenting a rotated token again revokes the whole session and every active token in it.",
    status: "covered",
    evidence: [
      "test/integration/refresh-rotation.spec.ts",
      "src/features/auth/sessions/refresh.spec.ts",
    ],
  },
  {
    id: "auth.account-deletion",
    acceptance:
      "Requesting deletion schedules the saga, the sweep finalizes it, personal fields are scrubbed and the stored objects are retired.",
    status: "covered",
    evidence: ["test/integration/account-deletion.spec.ts"],
  },
  {
    id: "auth.email-verification-delivery",
    acceptance:
      "A verification request enqueues the send job and delivery is attempted against the configured provider, with the token single-use.",
    status: "covered",
    evidence: ["test/integration/email-verification.spec.ts"],
  },
  {
    id: "http.idempotent-write",
    acceptance:
      "A retryable write with an Idempotency-Key executes once, replays its stored response with Idempotency-Replayed: true, and refuses a changed payload.",
    status: "covered",
    evidence: [
      "test/integration/idempotent-write.spec.ts",
      "src/platform/http/idempotency.spec.ts",
    ],
  },
  {
    id: "security.rate-limits",
    acceptance:
      "Requests past a policy ceiling answer 429 with RATE_LIMITED and a truthful Retry-After, and buckets are isolated per subject.",
    status: "pending",
    evidence: [
      "src/features/auth/shared/rate-limits.spec.ts",
      "src/platform/rate-limit/rate-limiter.spec.ts",
    ],
    reason:
      "the dialect is proven against a real limiter in a composed app; an end-to-end 429 through the worker would have to defeat the production policy window, so it needs a policy-override seam first",
  },
  {
    id: "users.profile-image-object-lifecycle",
    acceptance:
      "Attach, replace, expire and account-finalization each leave exactly one live object, and every retired object is deleted from storage.",
    status: "pending",
    evidence: [
      "src/features/users/profile-image/profile-image.jobs.spec.ts",
      "src/features/users/profile-image/profile-image-complete.spec.ts",
    ],
    reason:
      "signed requests are asserted against a fetch stub; the byte-level R2 round trip is a credentialed lane (ADR-0010), so the end-to-end object check cannot run here",
  },
  {
    id: "queue.retry-and-delivery",
    acceptance:
      "Scheduled work fans out to jobs, jobs execute once per message, and retries back off without duplicating side effects.",
    status: "pending",
    evidence: [
      "test/integration/cron-sweeps.spec.ts",
      "src/platform/queue/consumer.spec.ts",
    ],
    reason:
      "fan-out and job execution are covered end to end; retry, backoff and dead-letter semantics are proven at the platform level, where the queue consumer can be driven deterministically",
  },
  {
    id: "contract.parity-and-provenance",
    acceptance:
      "The committed contract is byte-identical to what the routes emit, every implemented operation is declared, and the family ruleset passes.",
    status: "pending",
    evidence: ["test/contract/dialect.spec.ts"],
    reason:
      "parity, provenance and the ruleset are enforced by the contract:check/contract:lint scripts with their own fixtures; the contract suite covers the composed-app dialect, not the snapshot comparison",
  },
];

export type OracleValidationOptions = Readonly<{
  exists?: (path: string) => boolean;
}>;

export function isEndToEndEvidence(path: string): boolean {
  return END_TO_END_EVIDENCE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function identityProblems(oracle: Oracle, seen: Set<string>): string[] {
  const problems: string[] = [];

  if (!ORACLE_ID_PATTERN.test(oracle.id)) {
    problems.push(
      `${oracle.id}: id must be dotted lowercase (feature.behaviour)`,
    );
  }
  if (seen.has(oracle.id)) problems.push(`${oracle.id}: duplicate id`);

  return problems;
}

function acceptanceProblems(oracle: Oracle): string[] {
  const problems: string[] = [];

  if (oracle.acceptance.trim().length < MIN_ACCEPTANCE_LENGTH) {
    problems.push(`${oracle.id}: acceptance must state the behaviour in full`);
  }
  if (
    oracle.status === "pending" &&
    (oracle.reason ?? "").trim().length < MIN_REASON_LENGTH
  ) {
    problems.push(
      `${oracle.id}: pending oracles must record why end-to-end evidence is missing`,
    );
  }

  return problems;
}

function evidenceProblems(
  oracle: Oracle,
  exists: (path: string) => boolean,
): string[] {
  if (oracle.evidence.length === 0) {
    return [`${oracle.id}: needs at least one evidence path`];
  }

  const problems = oracle.evidence
    .filter((path) => !exists(path))
    .map((path) => `${oracle.id}: evidence path does not exist: ${path}`);

  if (
    oracle.status === "covered" &&
    !oracle.evidence.some((path) => isEndToEndEvidence(path))
  ) {
    problems.push(
      `${oracle.id}: covered oracles need evidence under ${END_TO_END_EVIDENCE_PREFIXES.join(" or ")}`,
    );
  }

  return problems;
}

export function validateOracles(
  oracles: readonly Oracle[],
  root: string,
  options: OracleValidationOptions = {},
): string[] {
  const exists =
    options.exists ?? ((path: string) => existsSync(join(root, path)));
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const oracle of oracles) {
    problems.push(
      ...identityProblems(oracle, seen),
      ...acceptanceProblems(oracle),
      ...evidenceProblems(oracle, exists),
    );
    seen.add(oracle.id);
  }

  return problems;
}

export function oracleSummary(oracles: readonly Oracle[]): Readonly<{
  covered: number;
  pending: number;
  pendingIds: readonly string[];
}> {
  const pending = oracles.filter((oracle) => oracle.status === "pending");

  return {
    covered: oracles.length - pending.length,
    pending: pending.length,
    pendingIds: pending.map((oracle) => oracle.id),
  };
}

export function formatOracleReport(oracles: readonly Oracle[]): string {
  const summary = oracleSummary(oracles);
  const lines = [
    `[oracles] covered ${String(summary.covered)}, pending ${String(summary.pending)}`,
  ];

  for (const id of summary.pendingIds) {
    const oracle = oracles.find((entry) => entry.id === id);

    lines.push(
      `[oracles] pending ${id}: ${oracle?.reason ?? "no reason recorded"}`,
    );
  }

  return lines.join("\n");
}
