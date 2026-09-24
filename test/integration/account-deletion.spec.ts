import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../../src/worker";
import { authEnv, cleanAuthTables } from "../auth-fixtures";
import { captureConsoleLogs } from "../queue-fixtures";
import { createDb } from "../../src/platform/db/db";
import {
  sessions,
  userAccountDeletionAudits,
  users,
  userStatusChangeAudits,
} from "../../src/platform/db/schema";
import { scrubbedEmail } from "../../src/features/users/account-deletion.repository";

const TICK = Date.parse("2026-06-01T00:00:00.000Z");

function db() {
  return createDb(env.DB);
}

function controller(scheduledTime: number): ScheduledController {
  return {
    scheduledTime,
    cron: "0 * * * *",
    noRetry: () => undefined,
  };
}

async function seedDueUser(): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  const past = new Date(now.getTime() - 3_600_000);

  await db()
    .insert(users)
    .values({
      id,
      email: `due-${id}@example.com`,
      emailVerifiedAt: past,
      status: "ACTIVE",
      deletionRequestedAt: past,
      deletionScheduledFor: new Date(now.getTime() - 60_000),
      deletionRequestedSessionId: "session-1",
      deletionRequestedTraceId: "req-trace-integration",
      displayName: "Due",
      createdAt: past,
      updatedAt: past,
    });
  await db()
    .insert(sessions)
    .values({
      id: crypto.randomUUID(),
      userId: id,
      lastSeenAt: past,
      expiresAt: new Date(now.getTime() + 86_400_000),
      createdAt: past,
      updatedAt: past,
    });

  return id;
}

describe("account deletion through the cron sweep", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("finalizes a due account via the real queue", async () => {
    const userId = await seedDueUser();
    const { records, restore } = captureConsoleLogs();

    try {
      await worker.scheduled(controller(TICK), authEnv());

      await vi.waitFor(
        async () => {
          const rows = await db()
            .select()
            .from(users)
            .where(eq(users.id, userId));
          expect(rows[0]?.status).toBe("DELETED");
        },
        { timeout: 15_000, interval: 100 },
      );
    } finally {
      restore();
    }

    const rows = await db().select().from(users).where(eq(users.id, userId));
    expect(rows[0]?.email).toBe(scrubbedEmail(userId));
    expect(rows[0]?.deletedAt).toBeInstanceOf(Date);

    const deletionAudits = await db()
      .select()
      .from(userAccountDeletionAudits)
      .where(eq(userAccountDeletionAudits.targetUserId, userId));
    expect(deletionAudits.map((audit) => audit.action)).toEqual(["FINALIZED"]);
    expect(deletionAudits[0]?.traceId).toBe("req-trace-integration");

    const statusAudits = await db()
      .select()
      .from(userStatusChangeAudits)
      .where(eq(userStatusChangeAudits.targetUserId, userId));
    expect(statusAudits[0]).toMatchObject({
      oldStatus: "ACTIVE",
      newStatus: "DELETED",
    });

    const sweepLog = records.find(
      (record) =>
        record.message === "due account deletions enqueued" &&
        record.jobId ===
          `users.finalizeDueAccountDeletions-2026-06-01T00:00:00.000Z`,
    );
    expect(sweepLog?.enqueued).toBe(1);
  });
});
