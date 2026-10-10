import assert from "node:assert/strict";
import {
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
  acquireLock,
  isProcessAlive,
  LOCK_FILE_MODE,
  LOCK_PATH,
  readLock,
  releaseLock,
} from "./lock.ts";
import {
  formatMaintenanceReport,
  MAINTENANCE_DIRECTORY,
  MAINTENANCE_STEPS,
  runMaintenance,
} from "./maintenance.ts";

function root(): string {
  return mkdtempSync(join(tmpdir(), "cfkit-maintenance-"));
}

function receipts(directory: string): readonly string[] {
  return readdirSync(join(directory, MAINTENANCE_DIRECTORY)).filter((name) =>
    name.endsWith(".json"),
  );
}

test("maintenance: the registry runs its read-only steps in order", async () => {
  const directory = root();
  const calls: string[] = [];

  try {
    const run = await runMaintenance(directory, {
      runStep: (script) => {
        calls.push(script);

        return 0;
      },
    });

    assert.deepEqual(calls, [...MAINTENANCE_STEPS]);
    assert.deepEqual(
      run.steps.map((step) => step.id),
      [...MAINTENANCE_STEPS],
    );
    assert.equal(run.exitCode, 0);
    assert.match(formatMaintenanceReport(run), /steps 4; exit 0/);
    assert.equal(receipts(directory).length, 1);
    assert.equal(
      statSync(
        join(directory, MAINTENANCE_DIRECTORY, receipts(directory)[0] ?? ""),
      ).mode & 0o777,
      0o600,
    );

    // Idempotence: a second run adds a receipt and changes nothing else.
    const second = await runMaintenance(directory, {
      runStep: () => 0,
      now: new Date("2026-10-13T01:00:00.000Z"),
    });

    assert.equal(second.exitCode, 0);
    assert.equal(receipts(directory).length, 2);

    const receipt = JSON.parse(
      readFileSync(
        join(directory, MAINTENANCE_DIRECTORY, receipts(directory)[0] ?? ""),
        "utf8",
      ),
    ) as { schemaVersion: number; steps: readonly unknown[] };

    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.steps.length, MAINTENANCE_STEPS.length);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("maintenance: the first failing step stops the run", async () => {
  const directory = root();
  const calls: string[] = [];

  try {
    const run = await runMaintenance(directory, {
      runStep: (script) => {
        calls.push(script);

        return script === "smells:check" ? 1 : 0;
      },
    });

    assert.deepEqual(calls, ["plans:check", "smells:check"]);
    assert.equal(run.exitCode, 1);
    assert.equal(run.steps.at(-1)?.id, "smells:check");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("maintenance: a live lock blocks a second run and is released afterwards", async () => {
  const directory = root();

  try {
    const held = acquireLock(directory, { command: "someone else" });

    if (!held.ok) throw new Error(`expected the lock: ${held.reason}`);

    assert.equal(isProcessAlive(held.handle.record.pid), true);

    const blocked = await runMaintenance(directory, { runStep: () => 0 });

    assert.equal(blocked.exitCode, 1);
    assert.match(blocked.blockedBy ?? "", /another run holds|held by pid/);
    assert.equal(blocked.steps.length, 0);
    assert.match(formatMaintenanceReport(blocked), /blocked:/);

    releaseLock(directory, held.handle);

    const after = await runMaintenance(directory, { runStep: () => 0 });

    assert.equal(after.exitCode, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("lock: a stale lock from a dead process is reclaimed, a live one is respected", () => {
  const directory = root();

  try {
    mkdirSync(join(directory, ".cfkit"), { recursive: true });
    writeFileSync(
      join(directory, LOCK_PATH),
      JSON.stringify({
        pid: 2_147_483_646,
        command: "a crashed run",
        startedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    assert.equal(isProcessAlive(2_147_483_646), false);

    const reclaimed = acquireLock(directory, {
      command: "maintenance run --once",
    });

    assert.equal(reclaimed.ok, true);
    assert.equal(readLock(directory)?.command, "maintenance run --once");
    assert.equal(
      statSync(join(directory, LOCK_PATH)).mode & 0o777,
      LOCK_FILE_MODE,
    );

    const second = acquireLock(directory, { command: "events run --once" });

    if (second.ok)
      throw new Error("expected the live lock to block the second acquire");

    assert.match(second.reason, /held by pid/);

    releaseLock(directory, reclaimed.handle);
    assert.equal(readLock(directory), undefined);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
