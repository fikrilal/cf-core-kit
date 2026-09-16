import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createDeadLetterConsumer, createQueueConsumer } from "./consumer";
import { createJobRegistry, defineJob } from "./registry";
import {
  capturingLogger,
  fakeBatch,
  fakeMessage,
  sampleEnvelope,
  sampleJob,
  type LogLine,
} from "../../../test/queue-fixtures";

function buildConsumer(
  handle: (payload: { userId: string }) => Promise<void> = () =>
    Promise.resolve(),
) {
  const lines: LogLine[] = [];
  const consumer = createQueueConsumer({
    registry: createJobRegistry([sampleJob(handle)]),
    logger: capturingLogger(lines),
  });

  return { consumer, lines };
}

describe("queue consumer: success paths", () => {
  it("dispatches payloads with the job context and acks", async () => {
    const seen: { payload: unknown; context: unknown }[] = [];
    const lines: LogLine[] = [];
    const job = defineJob({
      name: "users.sweepSessions",
      payloadSchema: z.object({ userId: z.string().min(1) }),
      handle: (payload, context) => {
        seen.push({ payload, context });
        return Promise.resolve();
      },
    });
    const registry = createJobRegistry([job]);
    const consumer = createQueueConsumer({
      registry,
      logger: capturingLogger(lines),
    });
    const message = fakeMessage(sampleEnvelope(), 2);

    const result = await consumer(fakeBatch("cf-core-kit-jobs-dev", [message]));

    expect(result).toEqual({
      queue: "cf-core-kit-jobs-dev",
      acked: 1,
      retried: 0,
      discarded: 0,
    });
    expect(message.acks).toBe(1);
    expect(seen[0]?.payload).toEqual({ userId: "user-1" });
    expect(seen[0]?.context).toEqual({
      jobId: "users.sweepSessions-2026-06-01",
      traceId: "req-123",
      attempt: 2,
      enqueuedAt: "2026-06-01T00:00:00.000Z",
    });

    const summary = lines.find(
      (line) => line.message === "queue batch processed",
    );
    expect(summary?.fields).toMatchObject({
      acked: 1,
      retried: 0,
      discarded: 0,
      size: 1,
    });
  });
});

describe("queue consumer: failure paths", () => {
  it("retries handler failures with the backoff and keeps processing", async () => {
    let calls = 0;
    const { consumer, lines } = buildConsumer(() => {
      calls += 1;
      if (calls === 2) return Promise.reject(new Error("boom"));

      return Promise.resolve();
    });
    const first = fakeMessage(sampleEnvelope());
    const failing = fakeMessage(
      sampleEnvelope({ jobId: "users.sweepSessions-2", traceId: "req-2" }),
    );
    const last = fakeMessage(
      sampleEnvelope({ jobId: "users.sweepSessions-3" }),
    );

    const result = await consumer(
      fakeBatch("cf-core-kit-jobs-dev", [first, failing, last]),
    );

    expect(result.acked).toBe(2);
    expect(result.retried).toBe(1);
    expect(first.acks).toBe(1);
    expect(last.acks).toBe(1);
    expect(failing.acks).toBe(0);
    expect(failing.retries).toHaveLength(1);
    const delay = failing.retries[0]?.delaySeconds ?? 0;
    expect(delay).toBeGreaterThanOrEqual(30);
    expect(delay).toBeLessThanOrEqual(36);

    const failure = lines.find((line) => line.message === "job failed");
    expect(failure?.fields).toMatchObject({
      job: "users.sweepSessions",
      jobId: "users.sweepSessions-2",
      traceId: "req-2",
      error: "boom",
    });
  });

  it("acks malformed envelopes and retries unknown jobs and payload mismatches", async () => {
    const { consumer, lines } = buildConsumer();
    const malformed = fakeMessage({ nope: true });
    const unknown = fakeMessage(sampleEnvelope({ job: "users.unknownJob" }));
    const mismatch = fakeMessage(sampleEnvelope({ payload: { wrong: true } }));

    const result = await consumer(
      fakeBatch("cf-core-kit-jobs-dev", [malformed, unknown, mismatch]),
    );

    expect(result).toEqual({
      queue: "cf-core-kit-jobs-dev",
      acked: 0,
      retried: 2,
      discarded: 1,
    });
    expect(malformed.acks).toBe(1);
    expect(malformed.retries).toHaveLength(0);
    expect(unknown.retries).toHaveLength(1);
    expect(mismatch.retries).toHaveLength(1);

    const messages = lines.map((line) => line.message);
    expect(messages).toEqual([
      "job envelope rejected",
      "unknown job",
      "job payload rejected",
      "queue batch processed",
    ]);
  });
});

describe("dead letter consumer", () => {
  it("logs dead letters with their envelope and acks them", async () => {
    const lines: LogLine[] = [];
    const consumer = createDeadLetterConsumer({
      logger: capturingLogger(lines),
    });
    const valid = fakeMessage(sampleEnvelope(), 4);
    const malformed = fakeMessage("garbage");

    const result = await consumer(
      fakeBatch("cf-core-kit-dlq-dev", [valid, malformed]),
    );

    expect(result).toEqual({
      queue: "cf-core-kit-dlq-dev",
      acked: 0,
      retried: 0,
      discarded: 2,
    });
    expect(valid.acks).toBe(1);
    expect(malformed.acks).toBe(1);

    const received = lines.filter(
      (line) => line.message === "dead letter received",
    );
    expect(received).toHaveLength(2);
    expect(received[0]?.fields).toMatchObject({
      job: "users.sweepSessions",
      jobId: "users.sweepSessions-2026-06-01",
      traceId: "req-123",
      attempt: 4,
    });
    expect(received[1]?.fields.reason).toBeDefined();
  });
});
