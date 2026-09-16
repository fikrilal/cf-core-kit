import { z } from "zod";

export const JOB_ENVELOPE_VERSION = 1;
export const JOB_NAME_PATTERN = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/;
export const QUEUE_NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
export const MAX_JOB_ID_LENGTH = 160;
export const MAX_TRACE_ID_LENGTH = 128;

export type JobName = string;
export type QueueName = string;

export function jobName(value: string): JobName {
  if (!JOB_NAME_PATTERN.test(value)) {
    throw new Error(
      `Invalid job name "${value}" (Expected: dot-separated segments using lowerCamelCase, e.g. users.sweepSessions)`,
    );
  }

  return value;
}

export function queueName(value: string): QueueName {
  if (!QUEUE_NAME_PATTERN.test(value)) {
    throw new Error(
      `Invalid queue name "${value}" (Expected: lowercase letters, digits, and hyphens, starting with a letter, max 63 characters)`,
    );
  }

  return value;
}

export const jobEnvelopeSchema = z.object({
  v: z.literal(JOB_ENVELOPE_VERSION),
  job: z.string().regex(JOB_NAME_PATTERN),
  jobId: z.string().min(1).max(MAX_JOB_ID_LENGTH),
  traceId: z.string().min(1).max(MAX_TRACE_ID_LENGTH),
  enqueuedAt: z.iso.datetime(),
  payload: z.unknown(),
});

export type JobEnvelope = Readonly<{
  v: typeof JOB_ENVELOPE_VERSION;
  job: JobName;
  jobId: string;
  traceId: string;
  enqueuedAt: string;
  payload: unknown;
}>;
