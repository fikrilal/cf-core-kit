import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { cleanAuthTables } from "../../../test/auth-fixtures";
import { capturingLogger, type LogLine } from "../../../test/queue-fixtures";
import { fixedClock } from "../clock/clock";
import { SWEEP_BATCH_SIZE } from "../queue/defaults";
import type { JobContext, Job } from "../queue/registry";
import { createDb } from "../db/db";
import { createIdempotencySweepJobs } from "./idempotency.jobs";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const SCHEDULED_FOR = "2026-06-01T00:00:00.000Z";

const CONTEXT: JobContext = {
  jobId: `http.purgeExpiredIdempotencyRecords-${SCHEDULED_FOR}`,
  traceId: `cron:${SCHEDULED_FOR}`,
  attempt: 1,
  enqueuedAt: SCHEDULED_FOR,
};

function db() {
  return createDb(env.DB);
}

async function seedRecord(key: string, expiresAtMs: number): Promise<void> {
  await db().run(sql`
    INSERT OR REPLACE INTO idempotency_records (key, record, expires_at)
    VALUES (${key}, '{"v":1,"state":"completed","requestHash":"h","status":200,"hasBody":false,"completedAt":1}', ${expiresAtMs})
  `);
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

function buildJob(): { job: Job<{ scheduledFor: string }>; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const jobs = createIdempotencySweepJobs({
    db: db(),
    clock: fixedClock(NOW),
    logger: capturingLogger(lines),
  });

  return { job: jobs.purgeExpiredIdempotencyRecords, lines };
}

describe("http.purgeExpiredIdempotencyRecords", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("deletes expired records only and logs the run", async () => {
    await seedRecord("sweep-expired", NOW.getTime() - 1_000);
    await seedRecord("sweep-live", NOW.getTime() + 60_000);
    const { job, lines } = buildJob();

    const outcome = await job.dispatch(
      { scheduledFor: SCHEDULED_FOR },
      CONTEXT,
    );

    expect(outcome).toEqual({ ok: true });
    expect(await countRecords(["sweep-expired"])).toBe(0);
    expect(await countRecords(["sweep-live"])).toBe(1);

    const logged = lines.find(
      (line) => line.message === "idempotency records purged",
    );
    expect(logged?.fields).toMatchObject({
      jobId: CONTEXT.jobId,
      traceId: CONTEXT.traceId,
      scheduledFor: SCHEDULED_FOR,
      purged: 1,
    });
  });

  it("is bounded per run and repeat-safe", async () => {
    const keys: string[] = [];

    for (let index = 0; index < SWEEP_BATCH_SIZE + 3; index += 1) {
      const key = `sweep-batch-${String(index)}`;
      keys.push(key);
      await seedRecord(key, NOW.getTime() - (index + 1) * 1_000);
    }

    const { job, lines } = buildJob();
    const purgedCounts = () =>
      lines
        .filter((line) => line.message === "idempotency records purged")
        .map((line) => line.fields.purged);

    const first = await job.dispatch({ scheduledFor: SCHEDULED_FOR }, CONTEXT);
    expect(first).toEqual({ ok: true });
    expect(purgedCounts()).toEqual([SWEEP_BATCH_SIZE]);
    expect(await countRecords(keys)).toBe(3);

    const second = await job.dispatch({ scheduledFor: SCHEDULED_FOR }, CONTEXT);
    expect(second).toEqual({ ok: true });
    expect(purgedCounts()).toEqual([SWEEP_BATCH_SIZE, 3]);
    expect(await countRecords(keys)).toBe(0);

    const third = await job.dispatch({ scheduledFor: SCHEDULED_FOR }, CONTEXT);
    expect(third).toEqual({ ok: true });
    expect(purgedCounts()).toEqual([SWEEP_BATCH_SIZE, 3, 0]);
  });
});
