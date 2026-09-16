import { describe, expect, it } from "vitest";

import {
  MAX_MESSAGE_DELAY_SECONDS,
  QUEUE_DEFAULTS,
  retryDelaySeconds,
} from "./defaults";
import {
  JOB_ENVELOPE_VERSION,
  jobEnvelopeSchema,
  jobName,
  queueName,
} from "./job";
import { createJobRegistry, defineJob } from "./registry";
import { deadLetterQueueName, jobQueueName } from "./names";
import { sampleJob } from "../../../test/queue-fixtures";

describe("job naming", () => {
  it("accepts dot-separated lowerCamelCase and rejects the rest", () => {
    expect(jobName("users.sweepSessions")).toBe("users.sweepSessions");
    expect(jobName("auth.oidc.refresh")).toBe("auth.oidc.refresh");

    for (const invalid of [
      "sweep",
      "Users.sweep",
      "users..sweep",
      "users.sweep-x",
    ]) {
      expect(() => jobName(invalid)).toThrow(/Invalid job name/);
    }
  });

  it("validates queue names and derives environment names", () => {
    expect(queueName("cf-core-kit-jobs-dev")).toBe("cf-core-kit-jobs-dev");
    expect(() => queueName("CF-Jobs")).toThrow(/Invalid queue name/);

    expect(jobQueueName("staging")).toBe("cf-core-kit-jobs-staging");
    expect(deadLetterQueueName("prod")).toBe("cf-core-kit-dlq-prod");
  });
});

describe("job envelope", () => {
  it("round-trips a full envelope", () => {
    const envelope = {
      v: JOB_ENVELOPE_VERSION,
      job: "users.sweepSessions",
      jobId: "users.sweepSessions-1",
      traceId: "req-1",
      enqueuedAt: "2026-06-01T00:00:00.000Z",
      payload: { userId: "user-1" },
    };

    expect(jobEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it("rejects malformed envelopes", () => {
    for (const invalid of [
      {
        v: 2,
        job: "users.sweepSessions",
        jobId: "a",
        traceId: "b",
        enqueuedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        v: 1,
        job: "nope",
        jobId: "a",
        traceId: "b",
        enqueuedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        v: 1,
        job: "users.sweepSessions",
        jobId: "",
        traceId: "b",
        enqueuedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        v: 1,
        job: "users.sweepSessions",
        jobId: "a",
        traceId: "b",
        enqueuedAt: "not-a-date",
      },
      "not-an-object",
    ]) {
      expect(jobEnvelopeSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe("retry backoff", () => {
  it("is exponential with jitter and capped at the delay maximum", () => {
    const noJitter = { random: () => 0 };

    expect(retryDelaySeconds(1, noJitter)).toBe(30);
    expect(retryDelaySeconds(2, noJitter)).toBe(900);
    expect(retryDelaySeconds(3, noJitter)).toBe(27_000);

    const fullJitter = { random: () => 1 };
    expect(retryDelaySeconds(1, fullJitter)).toBe(
      Math.round(
        QUEUE_DEFAULTS.retryBaseDelaySeconds *
          (1 + QUEUE_DEFAULTS.retryJitterRatio),
      ),
    );

    expect(retryDelaySeconds(10, noJitter)).toBe(MAX_MESSAGE_DELAY_SECONDS);
    expect(retryDelaySeconds(10, fullJitter)).toBe(MAX_MESSAGE_DELAY_SECONDS);
  });
});

describe("job registry", () => {
  it("keeps definitions by name and rejects duplicates", () => {
    const job = sampleJob();
    const registry = createJobRegistry([job]);

    expect(registry.get("users.sweepSessions")).toBe(job);

    expect(() => createJobRegistry([job, job])).toThrow(/registered twice/);
  });

  it("validates the job name at definition time", () => {
    expect(() =>
      defineJob({
        name: "sweep",
        payloadSchema: sampleJob().payloadSchema,
        handle: () => Promise.resolve(),
      }),
    ).toThrow(/Invalid job name/);
  });
});
