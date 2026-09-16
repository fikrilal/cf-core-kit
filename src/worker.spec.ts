import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "./worker";
import { deadLetterQueueName, jobQueueName } from "./platform/queue/names";
import { authEnv } from "../test/auth-fixtures";
import { fakeBatch, fakeMessage, sampleEnvelope } from "../test/queue-fixtures";

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

function capturedLogs(): {
  records: Record<string, unknown>[];
  restore: () => void;
} {
  const records: Record<string, unknown>[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((value: unknown) => {
    if (typeof value !== "string") return;

    try {
      const parsed: unknown = JSON.parse(value);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return;
      }

      const record: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(parsed)) record[key] = entry;
      if (typeof record.message === "string") records.push(record);
    } catch {
      // non-JSON logs are not part of the assertion surface
    }
  });

  return {
    records,
    restore: () => {
      spy.mockRestore();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("worker queue routing", () => {
  it("routes the dead letter queue to the DLQ consumer", async () => {
    const { records, restore } = capturedLogs();
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

  it("routes the job queue to the registry consumer (empty registry retries)", async () => {
    const { records, restore } = capturedLogs();
    const message = fakeMessage(sampleEnvelope());
    const batch = fakeBatch(jobQueueName("dev"), [message]);

    try {
      await worker.queue(batch, authEnv());
    } finally {
      restore();
    }

    expect(message.retries).toHaveLength(1);

    const unknown = records.find((record) => record.message === "unknown job");
    expect(unknown?.job).toBe("users.sweepSessions");

    const summary = records.find(
      (record) => record.message === "queue batch processed",
    );
    expect(summary?.queue).toBe(jobQueueName("dev"));
  });
});
