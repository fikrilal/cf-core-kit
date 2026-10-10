import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  parsePlan,
  PLAN_README_FILE,
  PLAN_TEMPLATE_FILE,
  validatePlans,
  type PlanFile,
} from "./plans.ts";

/**
 * Queued-plan intake. A plan sits in `docs/exec-plans/queued/` until a run promotes exactly one of them into
 * `active/`, and the promotion is written down as a receipt so a crash cannot promote twice.
 *
 * The guards are deliberately conservative: nothing can be promoted while a file sits in `active/` or while a
 * task is tracked, and a queued plan that would not pass the plan contract *as an active plan* is refused with
 * the contract's own problems.
 */
export const QUEUED_DIRECTORY = "docs/exec-plans/queued";
export const ACTIVE_DIRECTORY = "docs/exec-plans/active";
export const EVENTS_DIRECTORY = ".cfkit/events";
export const RECEIPT_MODE = 0o600;
export const RECEIPT_DIRECTORY_MODE = 0o700;
export const RECEIPT_SCHEMA_VERSION = 1;

export type ReceiptStatus = "claimed" | "promoted";

export type Receipt = Readonly<{
  schemaVersion: number;
  /** Identity is source + task id + the hash of the queued bytes: the same plan re-edited is a new event. */
  identity: string;
  source: string;
  taskId: string;
  queuedHash: string;
  status: ReceiptStatus;
  claimedAt: string;
  promotedTo?: string;
}>;

export function queuedHash(source: string): string {
  return createHash("sha256").update(source).digest("hex").slice(0, 32);
}

export function receiptIdentity(
  input: Readonly<{
    source: string;
    taskId: string;
    queuedHash: string;
  }>,
): string {
  return `${input.source}#${input.taskId}#${input.queuedHash}`;
}

export function receiptPath(root: string, identity: string): string {
  return join(root, EVENTS_DIRECTORY, `${queuedHash(identity)}.json`);
}

export function readReceipts(root: string): readonly Receipt[] {
  const directory = join(root, EVENTS_DIRECTORY);

  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map(
      (name) =>
        JSON.parse(readFileSync(join(directory, name), "utf8")) as Receipt,
    )
    .sort((left, right) => left.identity.localeCompare(right.identity));
}

export function writeReceipt(root: string, receipt: Receipt): string {
  const directory = join(root, EVENTS_DIRECTORY);

  mkdirSync(directory, { recursive: true, mode: RECEIPT_DIRECTORY_MODE });

  const path = receiptPath(root, receipt.identity);

  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: RECEIPT_MODE,
  });

  return path;
}

export function listQueuedPlans(root: string): readonly PlanFile[] {
  const directory = join(root, QUEUED_DIRECTORY);

  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .filter((name) => name !== PLAN_README_FILE && name !== PLAN_TEMPLATE_FILE)
    .sort()
    .map((name) =>
      parsePlan(
        `${QUEUED_DIRECTORY}/${name}`,
        "queued",
        readFileSync(join(directory, name), "utf8"),
      ),
    );
}

export function activeFiles(root: string): readonly string[] {
  const directory = join(root, ACTIVE_DIRECTORY);

  if (!existsSync(directory)) return [];

  return readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .filter((name) => name !== PLAN_README_FILE && name !== PLAN_TEMPLATE_FILE);
}

/**
 * Only an **active** task blocks promotion. A verified or escalated state is history: leaving it on disk must
 * not freeze the queue forever (the first version of this guard did exactly that, which the live probe showed).
 * Unreadable states are ignored rather than treated as active — the doctor owns reporting them.
 */
export function activeTaskIds(root: string): readonly string[] {
  const directory = join(root, ".cfkit", "tasks");

  if (!existsSync(directory)) return [];

  const active: string[] = [];

  for (const name of readdirSync(directory)) {
    const statePath = join(directory, name, "state.json");

    if (!existsSync(statePath)) continue;

    try {
      const state = JSON.parse(readFileSync(statePath, "utf8")) as {
        status?: string;
      };

      if (state.status === "active") active.push(name);
    } catch {
      continue;
    }
  }

  return active;
}

/**
 * The promotion plan for one queued file: what would be written where, and the exact active-plan bytes.
 * `problems` is non-empty when the refusals say no — nothing is ever partially applied.
 */
export type PromotionPlan = Readonly<{
  taskId: string;
  source: string;
  targetPath: string;
  identity: string;
  queuedHash: string;
  activeSource: string;
  claimedReceipt: Receipt | undefined;
  promote: boolean;
  refusals: readonly string[];
}>;

export function planPromotion(root: string, queued: PlanFile): PromotionPlan {
  const source = readFileSync(join(root, queued.path), "utf8");
  const hash = queuedHash(source);
  const identity = receiptIdentity({
    source: queued.path,
    taskId: queued.taskId,
    queuedHash: hash,
  });
  const targetPath = `${ACTIVE_DIRECTORY}/${queued.path.split("/").at(-1) ?? "plan.md"}`;
  const activeSource = source.replace(
    /^- Status: queued$/m,
    "- Status: active",
  );
  const activePlan = parsePlan(targetPath, "active", activeSource);
  const refusals: string[] = [];
  const activePlans = activeFiles(root);

  if (activePlans.length > 0) {
    refusals.push(
      `${ACTIVE_DIRECTORY}/ already holds ${activePlans.join(", ")}`,
    );
  }

  const activeTasks = activeTaskIds(root);

  if (activeTasks.length > 0) {
    refusals.push(
      `active task${activeTasks.length === 1 ? "" : "s"} in flight: ${activeTasks.join(", ")}`,
    );
  }
  refusals.push(...validatePlans([activePlan]));

  const receipts = readReceipts(root);
  const claimed = receipts.find(
    (receipt) => receipt.identity === identity && receipt.status === "promoted",
  );

  if (claimed !== undefined) {
    refusals.push(
      `this exact queued revision was already promoted (${claimed.promotedTo ?? "unknown"})`,
    );
  }

  return {
    taskId: queued.taskId,
    source: queued.path,
    targetPath,
    identity,
    queuedHash: hash,
    activeSource,
    claimedReceipt: receipts.find(
      (receipt) =>
        receipt.identity === identity && receipt.status === "claimed",
    ),
    promote: refusals.length === 0,
    refusals,
  };
}

export type IntakeOutcome = Readonly<{
  promoted: string | undefined;
  refused: readonly Readonly<{ source: string; refusals: readonly string[] }>[];
  recovered: readonly string[];
  dryRun: boolean;
}>;

export function runIntake(
  root: string,
  input: Readonly<{ dryRun: boolean; now?: Date }>,
): IntakeOutcome {
  const now = input.now ?? new Date();
  const queued = listQueuedPlans(root);
  const refused: { source: string; refusals: readonly string[] }[] = [];
  const recovered: string[] = [];

  // Recovery first, and fail-closed: a claimed receipt whose file is still queued means a previous run died
  // between the claim and the move. Finishing that move is safe (same bytes, same target); anything else is
  // reported and the run stops.
  for (const receipt of readReceipts(root)) {
    if (receipt.status !== "claimed") continue;

    const stillQueued = queued.some((plan) => plan.path === receipt.source);

    if (!stillQueued) {
      writeReceipt(root, { ...receipt, status: "promoted" });
      recovered.push(`${receipt.source}: completion recorded`);
    }
  }

  if (input.dryRun) {
    return {
      promoted: undefined,
      refused: queued.map((plan) => {
        const promotion = planPromotion(root, plan);

        return { source: promotion.source, refusals: promotion.refusals };
      }),
      recovered,
      dryRun: true,
    };
  }

  for (const plan of queued) {
    const promotion = planPromotion(root, plan);

    if (!promotion.promote) {
      refused.push({ source: promotion.source, refusals: promotion.refusals });

      continue;
    }

    mkdirSync(join(root, ACTIVE_DIRECTORY), { recursive: true });
    writeReceipt(root, {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      identity: promotion.identity,
      source: promotion.source,
      taskId: promotion.taskId,
      queuedHash: promotion.queuedHash,
      status: "claimed",
      claimedAt: now.toISOString(),
    });

    writeFileSync(join(root, promotion.targetPath), promotion.activeSource);
    rmSync(join(root, promotion.source));

    writeReceipt(root, {
      schemaVersion: RECEIPT_SCHEMA_VERSION,
      identity: promotion.identity,
      source: promotion.source,
      taskId: promotion.taskId,
      queuedHash: promotion.queuedHash,
      status: "promoted",
      claimedAt: now.toISOString(),
      promotedTo: promotion.targetPath,
    });

    return {
      promoted: promotion.targetPath,
      refused,
      recovered,
      dryRun: false,
    };
  }

  return { promoted: undefined, refused, recovered, dryRun: false };
}

export function formatIntakeReport(outcome: IntakeOutcome): string {
  const lines = [
    `[events] ${outcome.dryRun ? "dry-run" : "run"}: promoted ${outcome.promoted ?? "nothing"}`,
  ];

  for (const recovery of outcome.recovered)
    lines.push(`[events] recovered ${recovery}`);
  for (const refusal of outcome.refused) {
    lines.push(
      `[events] refused ${refusal.source}: ${refusal.refusals.join("; ")}`,
    );
  }

  return lines.join("\n");
}
