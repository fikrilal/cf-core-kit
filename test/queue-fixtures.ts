import { z } from "zod";

import type { LogFields, Logger } from "../src/platform/logging/logger";
import { defineJob, type Job } from "../src/platform/queue/registry";

export type LogLine = Readonly<{
  level: string;
  message: string;
  fields: Record<string, unknown>;
}>;

export function capturingLogger(lines: LogLine[]): Logger {
  const record =
    (level: string) =>
    (message: string, fields?: LogFields): void => {
      lines.push({ level, message, fields: fields ?? {} });
    };

  return {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  };
}

export type SentMessage = Readonly<{
  body: unknown;
  options: { delaySeconds?: number } | undefined;
}>;

export function fakeQueue(
  send?: (body: unknown) => Promise<void>,
): Readonly<{ queue: Queue; sent: SentMessage[] }> {
  const sent: SentMessage[] = [];

  const queue = {
    send: async (body: unknown, options?: { delaySeconds?: number }) => {
      if (send !== undefined) await send(body);
      sent.push({ body, options });
    },
  } as unknown as Queue;

  return { queue, sent };
}

export type FakeMessage = Readonly<{
  id: string;
  attempts: number;
  body: unknown;
  ack: () => void;
  retry: (options?: { delaySeconds?: number }) => void;
  acks: number;
  retries: { delaySeconds?: number }[];
}>;

export function fakeMessage(body: unknown, attempts = 1): FakeMessage {
  const state = {
    acks: 0,
    retries: [] as { delaySeconds?: number }[],
  };

  return {
    id: crypto.randomUUID(),
    attempts,
    body,
    ack: () => {
      state.acks += 1;
    },
    retry: (options?: { delaySeconds?: number }) => {
      state.retries.push(options ?? {});
    },
    get acks() {
      return state.acks;
    },
    get retries() {
      return state.retries;
    },
  };
}

export function fakeBatch(
  queue: string,
  messages: readonly FakeMessage[],
): MessageBatch {
  return {
    queue,
    messages,
    ackAll: () => undefined,
    retryAll: () => undefined,
  } as unknown as MessageBatch;
}

export function sampleJob(
  handle: (payload: { userId: string }) => Promise<void> = () =>
    Promise.resolve(),
): Job<{ userId: string }> {
  return defineJob({
    name: "users.sweepSessions",
    payloadSchema: z.object({ userId: z.string().min(1) }),
    handle,
  });
}

export function sampleEnvelope(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    v: 1,
    job: "users.sweepSessions",
    jobId: "users.sweepSessions-2026-06-01",
    traceId: "req-123",
    enqueuedAt: "2026-06-01T00:00:00.000Z",
    payload: { userId: "user-1" },
    ...overrides,
  };
}
