import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The plan contract: what every file under `docs/exec-plans/` must declare for the harness to trust it.
 * PR 5.1 of the parity proposal; the template in `_template.md` is the source of the fuller shape, and the
 * metadata block is required for plans that are still moving (active/queued) because that is what the task
 * machine, the lanes and the handoff read.
 *
 * Legacy completed plans are deliberately **not** back-filled: Authority, Repair limit and Allowed paths were
 * never agreed for them, and inventing them after the fact would be worse than requiring the metadata for new
 * work. That grandfathering is recorded in the plan and in `docs/exec-plans/README.md`.
 */
export const PLAN_FOLDERS = ["active", "queued", "completed"] as const;
export const PLAN_TEMPLATE_FILE = "_template.md";
/** Folder documentation is not a plan: it is skipped wherever plans are listed (including `queued/`). */
export const PLAN_README_FILE = "README.md";
export const PLANS_DIRECTORY = "docs/exec-plans";
export const TASK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MIN_TASK_ID_LENGTH = 3;
export const MAX_TASK_ID_LENGTH = 80;
export const REQUIRED_SECTIONS = ["## Objective", "## Verification"] as const;
export const ACTIVE_REQUIRED_SECTIONS = [
  "## Steps",
  "## Acceptance Criteria",
] as const;
export const ACTIVE_METADATA_KEYS = [
  "Task ID",
  "Owner",
  "Risk",
  "Maximum risk",
  "Authority",
  "Repair limit",
  "Task timeout",
  "Impact areas",
  "Allowed paths",
  "Allowed actions",
] as const;
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export const AUTHORITY_VALUES = [
  "edit",
  "verify",
  "commit",
  "push",
  "draft-pr",
] as const;
export const AUTHORITY_BASELINE = ["edit", "verify"] as const;
export const MAX_TIMEOUT_HOURS = 24;
export const ACTIVE_LIMIT = 1;

export type PlanFolder = (typeof PLAN_FOLDERS)[number];

export type PlanFile = Readonly<{
  path: string;
  folder: PlanFolder;
  taskId: string;
  status: string | undefined;
  headers: Readonly<Record<string, string>>;
  sections: readonly string[];
  unchecked: readonly string[];
}>;

const HEADER_PATTERN = /^- ([A-Za-z][A-Za-z ]*?):\s*(.*)$/;
const UNCHECKED_PATTERN = /^ {0,3}- \[ \]/;
/** Sections whose unchecked boxes mean "unfinished work" rather than recorded debt. */
const EXECUTION_SECTIONS = [
  "## Steps",
  "## Acceptance Criteria",
  "## Completion Notes",
];

/**
 * Plan files are named `<date>_<slug>.md`, and the task id is the slug: the date is when the plan was
 * written, not part of its identity (`docs/exec-plans/2026-10-12_harness-core.md` -> `harness-core`).
 */
export function planTaskIdFromPath(path: string): string {
  const name = path.split("/").at(-1) ?? path;

  return name.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}_/, "");
}

export function parsePlan(
  path: string,
  folder: PlanFolder,
  source: string,
): PlanFile {
  const headers: Record<string, string> = {};
  const sections: string[] = [];
  const unchecked: string[] = [];
  let currentSection: string | undefined;

  for (const line of source.split("\n")) {
    const header = HEADER_PATTERN.exec(line);

    if (header?.[1] !== undefined && header[2] !== undefined) {
      const key = header[1];
      headers[key] = header[2];
    }
    if (line.startsWith("## ")) {
      currentSection = line.trim();
      sections.push(currentSection);
    }
    // Unchecked boxes under `## Follow-Ups` are recorded debt (the template asks for them); the rule about
    // finished work only binds the execution sections.
    if (UNCHECKED_PATTERN.test(line)) {
      if (EXECUTION_SECTIONS.includes(currentSection ?? "")) {
        unchecked.push(line.trim());
      }
    }
  }

  const declaredTaskId = headers["Task ID"];

  return {
    path,
    folder,
    taskId:
      declaredTaskId === undefined || declaredTaskId === ""
        ? planTaskIdFromPath(path)
        : declaredTaskId,
    status: headers.Status === "" ? undefined : headers.Status,
    headers,
    sections,
    unchecked,
  };
}

export function listPlans(root: string): PlanFile[] {
  const plans: PlanFile[] = [];

  for (const folder of PLAN_FOLDERS) {
    const directory = join(root, PLANS_DIRECTORY, folder);

    // An empty or absent `active/` is a legitimate state: it means no plan is in flight.
    if (!existsSync(directory)) continue;

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      if (
        entry.name === PLAN_TEMPLATE_FILE ||
        entry.name === PLAN_README_FILE
      ) {
        continue;
      }

      const path = `${PLANS_DIRECTORY}/${folder}/${entry.name}`;

      plans.push(
        parsePlan(path, folder, readFileSync(join(root, path), "utf8")),
      );
    }
  }

  return plans.sort((left, right) => left.path.localeCompare(right.path));
}

function identityProblems(plan: PlanFile, seen: Map<string, string>): string[] {
  const problems: string[] = [];

  if (
    !TASK_ID_PATTERN.test(plan.taskId) ||
    plan.taskId.length < MIN_TASK_ID_LENGTH ||
    plan.taskId.length > MAX_TASK_ID_LENGTH
  ) {
    problems.push(
      `${plan.path}: task id "${plan.taskId}" must be ${String(MIN_TASK_ID_LENGTH)}-${String(MAX_TASK_ID_LENGTH)} kebab-case characters`,
    );
  }

  const other = seen.get(plan.taskId);

  if (other !== undefined) {
    problems.push(
      `${plan.path}: task id "${plan.taskId}" is already used by ${other}`,
    );
  }
  seen.set(plan.taskId, plan.path);

  return problems;
}

function statusProblems(plan: PlanFile): string[] {
  if (plan.status === undefined) {
    return [`${plan.path}: missing required header "- Status:"`];
  }
  if (plan.status !== plan.folder) {
    return [
      `${plan.path}: - Status: "${plan.status}" does not match the folder (expected "${plan.folder}")`,
    ];
  }

  return [];
}

function sectionProblems(plan: PlanFile): string[] {
  const required =
    plan.folder === "completed"
      ? REQUIRED_SECTIONS
      : [...REQUIRED_SECTIONS, ...ACTIVE_REQUIRED_SECTIONS];

  return required
    .filter((section) => !plan.sections.includes(section))
    .map(
      (section) =>
        `${plan.path}: missing required section "${section}" (see docs/exec-plans/${PLAN_TEMPLATE_FILE})`,
    );
}

function metadataProblems(plan: PlanFile): string[] {
  if (plan.folder === "completed") return [];

  const problems = ACTIVE_METADATA_KEYS.filter(
    (key) => (plan.headers[key] ?? "") === "",
  ).map((key) => `${plan.path}: ${plan.folder} plans need "- ${key}:"`);

  return [
    ...problems,
    ...riskProblems(plan),
    ...authorityProblems(plan),
    ...policyProblems(plan),
  ];
}

function riskProblems(plan: PlanFile): string[] {
  const risks = ["Risk", "Maximum risk"]
    .map((key) => plan.headers[key])
    .filter((value): value is string => value !== undefined);

  return risks
    .filter(
      (value) => !RISK_LEVELS.includes(value as (typeof RISK_LEVELS)[number]),
    )
    .map(
      (value) => `${plan.path}: risk value "${value}" must be low|medium|high`,
    );
}

function authorityProblems(plan: PlanFile): string[] {
  const authority = (plan.headers.Authority ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");

  if (authority.length === 0) return [];

  const problems: string[] = [];

  for (const required of AUTHORITY_BASELINE) {
    if (!authority.includes(required)) {
      problems.push(`${plan.path}: Authority must include "${required}"`);
    }
  }

  for (const value of authority) {
    if (
      !AUTHORITY_VALUES.includes(value as (typeof AUTHORITY_VALUES)[number])
    ) {
      problems.push(`${plan.path}: unknown authority "${value}"`);
    }
  }

  return problems;
}

function formatProblems(plan: PlanFile): string[] {
  const problems: string[] = [];
  const repairLimit = plan.headers["Repair limit"];
  const timeout = plan.headers["Task timeout"];
  const allowedPaths = plan.headers["Allowed paths"];

  if (repairLimit !== undefined && !/^\d+$/.test(repairLimit)) {
    problems.push(
      `${plan.path}: Repair limit "${repairLimit}" must be a non-negative integer`,
    );
  }

  if (timeout !== undefined && !/^\d+[smh]$/.test(timeout)) {
    problems.push(
      `${plan.path}: Task timeout "${timeout}" must be Ns|Nm|Nh and at most ${String(MAX_TIMEOUT_HOURS)}h`,
    );
  } else if (timeout !== undefined && !withinTimeout(timeout)) {
    problems.push(
      `${plan.path}: Task timeout "${timeout}" exceeds the ${String(MAX_TIMEOUT_HOURS)}h ceiling`,
    );
  }

  if (allowedPaths?.trim() === "") {
    problems.push(`${plan.path}: Allowed paths must name at least one path`);
  }

  return problems;
}

function riskCapProblems(plan: PlanFile): string[] {
  const risk = plan.headers.Risk;
  const maximum = plan.headers["Maximum risk"];
  const isLevel = (value: string | undefined): boolean =>
    value !== undefined &&
    RISK_LEVELS.includes(value as (typeof RISK_LEVELS)[number]);

  if (!isLevel(risk) || !isLevel(maximum)) return [];
  if (
    RISK_LEVELS.indexOf(risk as (typeof RISK_LEVELS)[number]) <=
    RISK_LEVELS.indexOf(maximum as (typeof RISK_LEVELS)[number])
  ) {
    return [];
  }

  return [
    `${plan.path}: Risk "${String(risk)}" exceeds Maximum risk "${String(maximum)}"`,
  ];
}

function policyProblems(plan: PlanFile): string[] {
  return [...formatProblems(plan), ...riskCapProblems(plan)];
}

function withinTimeout(timeout: string): boolean {
  const value = Number(timeout.slice(0, -1));
  const unit = timeout.slice(-1);

  if (unit === "h") return value <= MAX_TIMEOUT_HOURS;
  if (unit === "m") return value <= MAX_TIMEOUT_HOURS * 60;

  return value <= MAX_TIMEOUT_HOURS * 3_600;
}

export function validatePlans(plans: readonly PlanFile[]): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();

  for (const plan of plans) {
    problems.push(
      ...identityProblems(plan, seen),
      ...statusProblems(plan),
      ...sectionProblems(plan),
      ...metadataProblems(plan),
    );

    if (plan.folder === "completed" && plan.unchecked.length > 0) {
      problems.push(
        `${plan.path}: completed plans must not carry unchecked steps (${plan.unchecked[0] ?? ""})`,
      );
    }
  }

  const active = plans.filter((plan) => plan.folder === "active");

  if (active.length > ACTIVE_LIMIT) {
    problems.push(
      `docs/exec-plans/active/: ${String(active.length)} plans are active; at most ${String(ACTIVE_LIMIT)} may be`,
    );
  }

  return problems;
}

export function planSummary(plans: readonly PlanFile[]): Readonly<{
  active: number;
  queued: number;
  completed: number;
}> {
  const count = (folder: PlanFolder) =>
    plans.filter((plan) => plan.folder === folder).length;

  return {
    active: count("active"),
    queued: count("queued"),
    completed: count("completed"),
  };
}

export function formatPlanReport(plans: readonly PlanFile[]): string {
  const summary = planSummary(plans);

  return `[plans] active ${String(summary.active)}, queued ${String(summary.queued)}, completed ${String(summary.completed)}`;
}
