import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import worker from "../../src/worker";
import { authEnv, cleanAuthTables } from "../auth-fixtures";
import { captureConsoleLogs } from "../queue-fixtures";
import { createDb } from "../../src/platform/db/db";
import { refreshTokens, sessions, users } from "../../src/platform/db/schema";

const FIRST_TICK = Date.parse("2026-06-01T00:00:00.000Z");
const SECOND_TICK = FIRST_TICK + 3_600_000;
const SCHEDULED_FOR = "2026-06-01T00:00:00.000Z";
const SECOND_SCHEDULED_FOR = new Date(SECOND_TICK).toISOString();

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

async function countSessions(): Promise<number> {
  const rows = await db().select({ id: sessions.id }).from(sessions);

  return rows.length;
}

async function countRecords(keys: readonly string[]): Promise<number> {
  const placeholders = sql.join(
    keys.map((key) => sql`${key}`),
    sql`, `,
  );
  const row = await db().get<{ total: number } | undefined>(sql`
    SELECT COUNT(*) AS total FROM idempotency_records WHERE key IN (${placeholders})
  `);

  return row?.total ?? 0;
}

async function seedExpiredState(): Promise<string> {
  const userId = crypto.randomUUID();
  const now = new Date();
  const expiredSessionId = crypto.randomUUID();

  await db()
    .insert(users)
    .values({
      id: userId,
      email: `cron-${userId}@example.com`,
      createdAt: now,
      updatedAt: now,
    });
  await db()
    .insert(sessions)
    .values([
      {
        id: expiredSessionId,
        userId,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() - 60_000),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        userId,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + 86_400_000),
        createdAt: now,
        updatedAt: now,
      },
    ]);
  await db()
    .insert(refreshTokens)
    .values({
      id: crypto.randomUUID(),
      sessionId: expiredSessionId,
      tokenHash: `hash-${crypto.randomUUID()}`,
      expiresAt: new Date(now.getTime() - 60_000),
      createdAt: now,
      updatedAt: now,
    });
  await db().run(sql`
    INSERT INTO idempotency_records (key, record, expires_at)
    VALUES
      ('cron-expired', '{}', ${now.getTime() - 1_000}),
      ('cron-live', '{}', ${now.getTime() + 60_000})
  `);

  return expiredSessionId;
}

async function waitForFirstTick(): Promise<void> {
  await vi.waitFor(
    async () => {
      expect(await countSessions()).toBe(1);
      expect(await countRecords(["cron-expired"])).toBe(0);
      expect(await countRecords(["cron-live"])).toBe(1);
    },
    { timeout: 15_000, interval: 100 },
  );
}

async function waitForSecondTick(
  records: readonly Record<string, unknown>[],
): Promise<void> {
  await vi.waitFor(
    () => {
      const sessionsRun = records.find(
        (record) =>
          record.message === "sessions purged" &&
          record.jobId === `auth.purgeExpiredSessions-${SECOND_SCHEDULED_FOR}`,
      );
      const idempotencyRun = records.find(
        (record) =>
          record.message === "idempotency records purged" &&
          record.jobId ===
            `http.purgeExpiredIdempotencyRecords-${SECOND_SCHEDULED_FOR}`,
      );

      expect(sessionsRun?.purged).toBe(0);
      expect(idempotencyRun?.purged).toBe(0);
    },
    { timeout: 15_000, interval: 100 },
  );
}

describe("cron sweeps through real queue delivery", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
    await db().run(sql`DELETE FROM idempotency_records`);
  });

  it("purges expired state across ticks and stays idempotent", async () => {
    await seedExpiredState();
    const { records, restore } = captureConsoleLogs();
    const expiredTokenCount = async () => {
      const rows = await db()
        .select({ id: refreshTokens.id })
        .from(refreshTokens);

      return rows.length;
    };

    try {
      await worker.scheduled(controller(FIRST_TICK), authEnv());
      await waitForFirstTick();

      await worker.scheduled(controller(SECOND_TICK), authEnv());
      await waitForSecondTick(records);
    } finally {
      restore();
    }

    const firstRun = records.find(
      (record) =>
        record.message === "sessions purged" &&
        record.jobId === `auth.purgeExpiredSessions-${SCHEDULED_FOR}`,
    );
    expect(firstRun?.purged).toBe(1);
    expect(firstRun?.traceId).toBe(`cron:${SCHEDULED_FOR}`);

    expect(await expiredTokenCount()).toBe(0);
    expect(await countSessions()).toBe(1);
  });
});
