import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { cleanAuthTables } from "../../../test/auth-fixtures";
import { capturingLogger, type LogLine } from "../../../test/queue-fixtures";
import { fixedClock } from "../../platform/clock/clock";
import { SWEEP_BATCH_SIZE } from "../../platform/queue/defaults";
import type { JobContext, Job } from "../../platform/queue/registry";
import { createDb } from "../../platform/db/db";
import { refreshTokens, sessions, users } from "../../platform/db/schema";
import { createAuthSweepJobs } from "./sweep.jobs";

const NOW = new Date("2026-06-01T00:00:00.000Z");
const SCHEDULED_FOR = "2026-06-01T00:00:00.000Z";

const CONTEXT: JobContext = {
  jobId: `auth.purgeExpiredSessions-${SCHEDULED_FOR}`,
  traceId: `cron:${SCHEDULED_FOR}`,
  attempt: 1,
  enqueuedAt: SCHEDULED_FOR,
};

function db() {
  return createDb(env.DB);
}

async function seedUser(): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();

  await db()
    .insert(users)
    .values({
      id,
      email: `sweep-${id}@example.com`,
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });

  return id;
}

async function seedSession(
  userId: string,
  input: Readonly<{ expiresAt: Date; revokedAt?: Date }>,
): Promise<{ sessionId: string; tokenId: string }> {
  const sessionId = crypto.randomUUID();
  const tokenId = crypto.randomUUID();
  const createdAt = new Date("2026-05-01T00:00:00.000Z");

  await db()
    .insert(sessions)
    .values({
      id: sessionId,
      userId,
      lastSeenAt: createdAt,
      expiresAt: input.expiresAt,
      revokedAt: input.revokedAt ?? null,
      createdAt,
      updatedAt: createdAt,
    });
  await db()
    .insert(refreshTokens)
    .values({
      id: tokenId,
      sessionId,
      tokenHash: `hash-${tokenId}`,
      expiresAt: input.expiresAt,
      createdAt,
      updatedAt: createdAt,
    });

  return { sessionId, tokenId };
}

function buildJob(): { job: Job<{ scheduledFor: string }>; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const jobs = createAuthSweepJobs({
    db: db(),
    clock: fixedClock(NOW),
    logger: capturingLogger(lines),
  });

  return { job: jobs.purgeExpiredSessions, lines };
}

describe("auth.purgeExpiredSessions", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("deletes expired sessions, cascades tokens, and keeps live ones", async () => {
    const userId = await seedUser();
    const expired = await seedSession(userId, {
      expiresAt: new Date(NOW.getTime() - 60_000),
      revokedAt: new Date(NOW.getTime() - 120_000),
    });
    const live = await seedSession(userId, {
      expiresAt: new Date(NOW.getTime() + 60_000),
    });
    const { job, lines } = buildJob();

    const outcome = await job.dispatch(
      { scheduledFor: SCHEDULED_FOR },
      CONTEXT,
    );

    expect(outcome).toEqual({ ok: true });

    const remainingSessions = await db().select().from(sessions);
    expect(remainingSessions.map((row) => row.id)).toEqual([live.sessionId]);

    const remainingTokens = await db().select().from(refreshTokens);
    expect(remainingTokens.map((row) => row.id)).toEqual([live.tokenId]);
    expect(expired.tokenId).not.toBe(live.tokenId);

    const logged = lines.find((line) => line.message === "sessions purged");
    expect(logged?.fields).toMatchObject({
      jobId: CONTEXT.jobId,
      traceId: CONTEXT.traceId,
      scheduledFor: SCHEDULED_FOR,
      purged: 1,
    });
  });

  it("is bounded per run and repeat-safe", async () => {
    const userId = await seedUser();

    for (let index = 0; index < SWEEP_BATCH_SIZE + 3; index += 1) {
      await seedSession(userId, {
        expiresAt: new Date(NOW.getTime() - (index + 1) * 60_000),
      });
    }

    const { job, lines } = buildJob();
    const purgedCounts = () =>
      lines
        .filter((line) => line.message === "sessions purged")
        .map((line) => line.fields.purged);

    const first = await job.dispatch({ scheduledFor: SCHEDULED_FOR }, CONTEXT);
    expect(first).toEqual({ ok: true });
    expect(purgedCounts()).toEqual([SWEEP_BATCH_SIZE]);
    expect(await db().select().from(sessions)).toHaveLength(3);

    const second = await job.dispatch({ scheduledFor: SCHEDULED_FOR }, CONTEXT);
    expect(second).toEqual({ ok: true });
    expect(purgedCounts()).toEqual([SWEEP_BATCH_SIZE, 3]);
    expect(await db().select().from(sessions)).toHaveLength(0);

    const third = await job.dispatch({ scheduledFor: SCHEDULED_FOR }, CONTEXT);
    expect(third).toEqual({ ok: true });
    expect(purgedCounts()).toEqual([SWEEP_BATCH_SIZE, 3, 0]);

    const tokenRows = await db().select().from(refreshTokens);
    expect(tokenRows).toHaveLength(0);
  });

  it("rejects malformed payloads", async () => {
    const { job } = buildJob();

    const outcome = await job.dispatch({}, CONTEXT);

    expect(outcome.ok).toBe(false);
  });
});
