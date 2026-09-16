import { describe, expect, it } from "vitest";

import { fixedClock } from "../clock/clock";
import { createQueueProducer } from "./producer";
import {
  capturingLogger,
  fakeQueue,
  sampleJob,
  type LogLine,
} from "../../../test/queue-fixtures";

const INSTANT = new Date("2026-06-01T00:00:00.000Z");

function buildProducer(send?: (body: unknown) => Promise<void>) {
  const lines: LogLine[] = [];
  const { queue, sent } = fakeQueue(send);
  const producer = createQueueProducer({
    queue,
    clock: fixedClock(INSTANT),
    logger: capturingLogger(lines),
  });

  return { producer, sent, lines };
}

describe("queue producer", () => {
  it("stamps a versioned envelope and sends once", async () => {
    const { producer, sent, lines } = buildProducer();

    const result = await producer.enqueue(sampleJob(), { userId: "user-1" });

    expect(result).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.options).toBeUndefined();

    const body = sent[0]?.body as Record<string, unknown>;
    expect(body.v).toBe(1);
    expect(body.job).toBe("users.sweepSessions");
    expect(body.enqueuedAt).toBe("2026-06-01T00:00:00.000Z");
    expect(body.payload).toEqual({ userId: "user-1" });
    expect(body.jobId).toMatch(/^users\.sweepSessions-/);
    expect(body.traceId).toBe(body.jobId);

    expect(lines.map((line) => line.message)).toEqual(["job enqueued"]);
  });

  it("honors explicit identifiers and a delay", async () => {
    const { producer, sent } = buildProducer();

    await producer.enqueue(
      sampleJob(),
      { userId: "user-1" },
      {
        jobId: "users.sweepSessions-2026-06-01",
        traceId: "req-9",
        delaySeconds: 600,
      },
    );

    const body = sent[0]?.body as Record<string, unknown>;
    expect(body.jobId).toBe("users.sweepSessions-2026-06-01");
    expect(body.traceId).toBe("req-9");
    expect(sent[0]?.options).toEqual({ delaySeconds: 600 });
  });

  it("rejects invalid payloads before sending", async () => {
    const { producer, sent, lines } = buildProducer();

    const result = await producer.enqueue(sampleJob(), { userId: "" });

    expect(result).toBe(false);
    expect(sent).toHaveLength(0);
    expect(lines.map((line) => line.message)).toEqual(["job payload rejected"]);
  });

  it("rejects out-of-range delays and over-long identifiers", async () => {
    const { producer, sent, lines } = buildProducer();

    expect(
      await producer.enqueue(
        sampleJob(),
        { userId: "u" },
        { delaySeconds: 86_401 },
      ),
    ).toBe(false);
    expect(
      await producer.enqueue(
        sampleJob(),
        { userId: "u" },
        { jobId: "x".repeat(161) },
      ),
    ).toBe(false);
    expect(
      await producer.enqueue(sampleJob(), { userId: "u" }, { jobId: "" }),
    ).toBe(false);
    expect(
      await producer.enqueue(sampleJob(), { userId: "u" }, { traceId: "" }),
    ).toBe(false);
    expect(sent).toHaveLength(0);
    expect(lines.map((line) => line.message)).toEqual([
      "job delay out of range",
      "job identifier invalid",
      "job identifier invalid",
      "job identifier invalid",
    ]);
  });

  it("returns false and logs when the send fails", async () => {
    const { producer, lines } = buildProducer(() =>
      Promise.reject(new Error("queue unavailable")),
    );

    const result = await producer.enqueue(sampleJob(), { userId: "u" });

    expect(result).toBe(false);
    const failure = lines.find((line) => line.message === "job enqueue failed");
    expect(failure?.fields.error).toBe("queue unavailable");
  });
});
