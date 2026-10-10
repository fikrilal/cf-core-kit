import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  ACTIVE_DIRECTORY,
  EVENTS_DIRECTORY,
  formatIntakeReport,
  listQueuedPlans,
  planPromotion,
  QUEUED_DIRECTORY,
  readReceipts,
  RECEIPT_MODE,
  runIntake,
} from "./events.ts";

const NOW = new Date("2026-10-13T00:00:00.000Z");

function queuedPlan(overrides: Record<string, string> = {}): string {
  const headers: Record<string, string> = {
    Status: "queued",
    Owner: "fikrilal",
    "Task ID": "sample-task",
    Risk: "low",
    "Maximum risk": "medium",
    Authority: "edit, verify",
    "Repair limit": "2",
    "Task timeout": "30m",
    Date: "2026-10-13",
    "Impact areas": "API/contract: no",
    "Allowed paths": "docs/exec-plans/queued/sample-task.md",
    "Allowed actions": "edit, verify",
    ...overrides,
  };

  return `# Queued sample

${Object.entries(headers)
  .filter(([, value]) => value !== "-drop-")
  .map(([key, value]) => `- ${key}: ${value}`)
  .join("\n")}

## Objective

Do the thing.

## Steps

- [ ] Step one

## Acceptance Criteria

1. Done.

## Verification

\`\`\`bash
npm run verify
\`\`\`
`;
}

function root(
  plans: Record<string, string> = { "sample-task.md": queuedPlan() },
): string {
  const directory = mkdtempSync(join(tmpdir(), "cfkit-events-"));

  mkdirSync(join(directory, QUEUED_DIRECTORY), { recursive: true });

  for (const [name, source] of Object.entries(plans)) {
    writeFileSync(join(directory, QUEUED_DIRECTORY, name), source);
  }

  return directory;
}

function onlyQueuedPlan(directory: string) {
  const [plan] = listQueuedPlans(directory);

  if (plan === undefined) throw new Error("expected a queued plan");

  return plan;
}

function firstReceiptFile(directory: string): string {
  const name = readdirSync(join(directory, EVENTS_DIRECTORY)).find((entry) =>
    entry.endsWith(".json"),
  );

  if (name === undefined) throw new Error("expected a receipt");

  return join(directory, EVENTS_DIRECTORY, name);
}

test("events: a dry run reports refusals and writes nothing", () => {
  const directory = root();

  try {
    const outcome = runIntake(directory, { dryRun: true, now: NOW });

    assert.equal(outcome.promoted, undefined);
    assert.equal(outcome.refused.length, 1);

    const [refusal] = outcome.refused;

    if (refusal === undefined) throw new Error("expected a refusal report");

    assert.deepEqual(refusal.refusals, []);
    assert.equal(existsSync(join(directory, EVENTS_DIRECTORY)), false);
    assert.equal(listQueuedPlans(directory).length, 1);
    assert.match(formatIntakeReport(outcome), /dry-run: promoted nothing/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("events: a promotion moves the plan, flips its status and writes a private receipt", () => {
  const directory = root();

  try {
    const outcome = runIntake(directory, { dryRun: false, now: NOW });

    assert.equal(outcome.promoted, `${ACTIVE_DIRECTORY}/sample-task.md`);
    assert.equal(listQueuedPlans(directory).length, 0);
    assert.equal(
      existsSync(join(directory, QUEUED_DIRECTORY, "sample-task.md")),
      false,
    );

    const active = readFileSync(
      join(directory, ACTIVE_DIRECTORY, "sample-task.md"),
      "utf8",
    );

    assert.match(active, /^- Status: active$/m);
    assert.ok(!active.includes("- Status: queued"));

    const receipts = readReceipts(directory);

    assert.equal(receipts.length, 1);

    const [receipt] = receipts;

    if (receipt === undefined) throw new Error("expected a receipt");

    assert.equal(receipt.status, "promoted");
    assert.equal(receipt.promotedTo, `${ACTIVE_DIRECTORY}/sample-task.md`);
    assert.equal(receipt.taskId, "sample-task");
    assert.equal(
      statSync(firstReceiptFile(directory)).mode & 0o777,
      RECEIPT_MODE,
    );
    assert.match(
      formatIntakeReport(outcome),
      /promoted docs\/exec-plans\/active\/sample-task.md/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("events: an occupied active folder or a tracked task refuses promotion", () => {
  const directory = root();

  try {
    mkdirSync(join(directory, ACTIVE_DIRECTORY), { recursive: true });
    writeFileSync(
      join(directory, ACTIVE_DIRECTORY, "someone-else.md"),
      "# In flight\n",
    );

    const blocked = planPromotion(directory, onlyQueuedPlan(directory));

    assert.equal(blocked.promote, false);
    assert.ok(
      blocked.refusals.some((refusal) =>
        refusal.includes("already holds someone-else.md"),
      ),
    );

    rmSync(join(directory, ACTIVE_DIRECTORY, "someone-else.md"));
    mkdirSync(join(directory, ".cfkit", "tasks", "tracked-task"), {
      recursive: true,
    });
    writeFileSync(
      join(directory, ".cfkit", "tasks", "tracked-task", "state.json"),
      JSON.stringify({ status: "active" }),
    );

    const tracked = planPromotion(directory, onlyQueuedPlan(directory));

    assert.equal(tracked.promote, false);
    assert.ok(
      tracked.refusals.some((refusal) =>
        refusal.includes("active task in flight: tracked-task"),
      ),
    );

    // A finished task is history, not a blocker.
    writeFileSync(
      join(directory, ".cfkit", "tasks", "tracked-task", "state.json"),
      JSON.stringify({ status: "verified" }),
    );

    assert.equal(
      planPromotion(directory, onlyQueuedPlan(directory)).promote,
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("events: a queued plan that would not pass the contract is refused with its problems", () => {
  const directory = root({
    "broken-plan.md": queuedPlan({
      "Task ID": "-drop-",
      "Maximum risk": "-drop-",
    }),
  });

  try {
    const promotion = planPromotion(directory, onlyQueuedPlan(directory));

    assert.equal(promotion.promote, false);
    assert.ok(
      promotion.refusals.some((refusal) =>
        refusal.includes('"- Maximum risk:"'),
      ),
    );
    assert.match(
      formatIntakeReport(runIntake(directory, { dryRun: false, now: NOW })),
      /refused/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("events: identity covers the bytes, so the same revision is never promoted twice", () => {
  const directory = root();

  try {
    runIntake(directory, { dryRun: false, now: NOW });

    // Put the same plan back, unchanged: the same revision must not be promoted again.
    writeFileSync(
      join(directory, QUEUED_DIRECTORY, "sample-task.md"),
      queuedPlan(),
    );

    const same = runIntake(directory, { dryRun: false, now: NOW });

    assert.equal(same.promoted, undefined);
    assert.ok(
      same.refused[0]?.refusals.some((refusal) =>
        refusal.includes("already promoted"),
      ),
    );

    // An edited plan is a new revision, and therefore a new event — once the active folder frees up again
    // (the first promotion is still sitting there, and the occupancy guard is doing its job).
    rmSync(join(directory, ACTIVE_DIRECTORY, "sample-task.md"));
    writeFileSync(
      join(directory, QUEUED_DIRECTORY, "sample-task.md"),
      queuedPlan({ Risk: "medium" }),
    );

    const edited = planPromotion(directory, onlyQueuedPlan(directory));

    assert.equal(edited.promote, true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("events: a claimed receipt whose file is gone is recovered as completion", () => {
  const directory = root();

  try {
    const plan = onlyQueuedPlan(directory);
    const promotion = planPromotion(directory, plan);

    mkdirSync(join(directory, EVENTS_DIRECTORY), { recursive: true });
    writeFileSync(
      join(directory, EVENTS_DIRECTORY, "claimed.json"),
      JSON.stringify({
        schemaVersion: 1,
        identity: promotion.identity,
        source: promotion.source,
        taskId: promotion.taskId,
        queuedHash: promotion.queuedHash,
        status: "claimed",
        claimedAt: NOW.toISOString(),
      }),
    );
    rmSync(join(directory, promotion.source));

    const outcome = runIntake(directory, { dryRun: false, now: NOW });

    assert.deepEqual(outcome.recovered, [
      `${promotion.source}: completion recorded`,
    ]);
    assert.equal(readReceipts(directory)[0]?.status, "promoted");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
