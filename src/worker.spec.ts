import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker from "./worker";
import { authEnv, cleanAuthTables } from "../test/auth-fixtures";
import {
  captureConsoleLogs,
  fakeBatch,
  fakeMessage,
  fakeQueue,
  sampleEnvelope,
} from "../test/queue-fixtures";
import { deadLetterQueueName, jobQueueName } from "./platform/queue/names";
import { createDb } from "./platform/db/db";
import {
  refreshTokens,
  sessions,
  storedFiles,
  users,
} from "./platform/db/schema";
import { eq } from "drizzle-orm";
import { stubSignedFetch } from "../test/profile-image-fixtures";

describe("worker", () => {
  it("serves the root banner inside the envelope", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/"),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    await expect(response.json()).resolves.toEqual({
      data: {
        name: "cf-core-kit",
        version: "dev",
        commit: "none",
        appEnv: "dev",
      },
    });
  });

  it("renders unknown paths as not-found problems", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/unknown"),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("serves health and readiness through the composition", async () => {
    const health = await worker.fetch(
      new Request("https://example.com/health"),
      env,
    );
    const ready = await worker.fetch(
      new Request("https://example.com/ready"),
      env,
    );

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({ status: "ok" });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("worker queue routing", () => {
  it("routes the dead letter queue to the DLQ consumer", async () => {
    const { records, restore } = captureConsoleLogs();
    const batch = fakeBatch(deadLetterQueueName("dev"), [
      fakeMessage(sampleEnvelope(), 5),
    ]);

    try {
      await worker.queue(batch, authEnv());
    } finally {
      restore();
    }

    const received = records.find(
      (record) => record.message === "dead letter received",
    );
    expect(received).toBeDefined();
    expect(received?.attempts ?? received?.attempt).toBe(5);
    expect(received?.jobId).toBe("users.sweepSessions-2026-06-01");
  });

  it("retries unknown jobs with the backoff", async () => {
    const { records, restore } = captureConsoleLogs();
    const message = fakeMessage(sampleEnvelope());
    const batch = fakeBatch(jobQueueName("dev"), [message]);

    try {
      await worker.queue(batch, authEnv());
    } finally {
      restore();
    }

    expect(message.retries).toHaveLength(1);
    const delay = message.retries[0]?.delaySeconds ?? 0;
    expect(delay).toBeGreaterThanOrEqual(30);

    const unknown = records.find((record) => record.message === "unknown job");
    expect(unknown?.job).toBe("users.sweepSessions");

    const summary = records.find(
      (record) => record.message === "queue batch processed",
    );
    expect(summary?.queue).toBe(jobQueueName("dev"));
  });
});

describe("worker queue registry", () => {
  beforeEach(async () => {
    await cleanAuthTables(createDb(env.DB));
  });

  it("dispatches registered jobs and purges expired state", async () => {
    const db = createDb(env.DB);
    const userId = crypto.randomUUID();
    const now = new Date();

    await db.insert(users).values({
      id: userId,
      email: `worker-${userId}@example.com`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sessions).values({
      id: crypto.randomUUID(),
      userId,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() - 60_000),
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(refreshTokens).values({
      id: crypto.randomUUID(),
      sessionId: (await db.select().from(sessions))[0]?.id ?? "",
      tokenHash: `hash-${crypto.randomUUID()}`,
      expiresAt: new Date(now.getTime() - 60_000),
      createdAt: now,
      updatedAt: now,
    });

    const { records, restore } = captureConsoleLogs();
    const message = fakeMessage(
      sampleEnvelope({
        job: "auth.purgeExpiredSessions",
        jobId: "auth.purgeExpiredSessions-2026-06-01T00:00:00.000Z",
        traceId: "cron:2026-06-01T00:00:00.000Z",
        payload: { scheduledFor: "2026-06-01T00:00:00.000Z" },
      }),
    );

    try {
      await worker.queue(fakeBatch(jobQueueName("dev"), [message]), authEnv());
    } finally {
      restore();
    }

    expect(message.acks).toBe(1);
    expect(message.retries).toHaveLength(0);

    const remaining = await db.select().from(sessions);
    expect(remaining).toHaveLength(0);

    const purged = records.find(
      (record) => record.message === "sessions purged",
    );
    expect(purged?.purged).toBeGreaterThanOrEqual(1);
    expect(purged?.traceId).toBe("cron:2026-06-01T00:00:00.000Z");
  });
});

describe("worker queue cleanup wiring", () => {
  beforeEach(async () => {
    await cleanAuthTables(createDb(env.DB));
  });

  it("deletes retired stored objects through the queue with the configured storage", async () => {
    const db = createDb(env.DB);
    const userId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const now = new Date();

    await db.insert(users).values({
      id: userId,
      email: `cleanup-${userId}@example.com`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(storedFiles).values({
      id: fileId,
      ownerUserId: userId,
      purpose: "PROFILE_IMAGE",
      status: "DELETED",
      bucket: "cf-core-kit-dev",
      objectKey: `users/${userId}/profile-images/${fileId}`,
      contentType: "image/webp",
      sizeBytes: 4,
      uploadedAt: null,
      deletedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const calls = stubSignedFetch(() => new Response(null, { status: 204 }));
    const r2Env = {
      ...authEnv(),
      R2_ACCESS_KEY_ID: "CFEXAMPLEKEY12345",
      R2_SECRET_ACCESS_KEY: "c2VjcmV0LXRlc3Qta2V5",
    };
    const message = fakeMessage(
      sampleEnvelope({
        job: "users.profileImage.deleteStoredFile",
        jobId: `users.profileImage.deleteStoredFile-${fileId}`,
        payload: {
          fileId,
          ownerUserId: userId,
          enqueuedAt: "2026-06-01T00:00:00.000Z",
        },
      }),
    );
    const { records, restore } = captureConsoleLogs();

    try {
      await worker.queue(fakeBatch(jobQueueName("dev"), [message]), r2Env);
    } finally {
      restore();
    }

    expect(message.acks).toBe(1);
    expect(calls.map((call) => call.method)).toEqual(["DELETE"]);

    const rows = await db
      .select()
      .from(storedFiles)
      .where(eq(storedFiles.id, fileId));
    expect(rows[0]?.status).toBe("DELETED");
    const cleanup = records.find(
      (record) => record.message === "profile image cleanup complete",
    );
    expect(cleanup?.outcome).toBe("deleted");
  });
});

describe("worker scheduled fan-out", () => {
  it("enqueues every sweep with deterministic ids and the cron trace id", async () => {
    const { queue, sent } = fakeQueue();
    const scheduledFor = "2026-06-01T00:00:00.000Z";
    const controller: ScheduledController = {
      scheduledTime: Date.parse(scheduledFor),
      cron: "0 * * * *",
      noRetry: () => undefined,
    };

    await worker.scheduled(controller, { ...authEnv(), JOBS: queue });

    expect(sent).toHaveLength(3);

    const bodies = sent.map((entry) => entry.body as Record<string, unknown>);
    const names = bodies.map((body) => body.job);

    expect(names).toEqual([
      "auth.purgeExpiredSessions",
      "http.purgeExpiredIdempotencyRecords",
      "users.finalizeDueAccountDeletions",
    ]);

    for (const body of bodies) {
      expect(body.traceId).toBe(`cron:${scheduledFor}`);
      expect(body.jobId).toBe(`${String(body.job)}-${scheduledFor}`);
      expect(body.payload).toEqual({ scheduledFor });
    }
  });
});
