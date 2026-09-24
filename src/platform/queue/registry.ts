import type { z } from "zod";

import { jobName, type JobName } from "./job";

export type JobContext = Readonly<{
  jobId: string;
  traceId: string;
  attempt: number;
  enqueuedAt: string;
}>;

export type JobHandler<TPayload> = (
  payload: TPayload,
  context: JobContext,
) => Promise<void>;

export type DispatchOutcome =
  Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;

export type DispatchFn = (
  rawPayload: unknown,
  context: JobContext,
) => Promise<DispatchOutcome>;

export type Job<TPayload> = Readonly<{
  name: JobName;
  payloadSchema: z.ZodType<TPayload>;
  handle: JobHandler<TPayload>;
  dispatch: DispatchFn;
}>;

export type JobSpec<TPayload> = Readonly<{
  name: JobName;
  payloadSchema: z.ZodType<TPayload>;
}>;

export type AnyJob = Readonly<{
  name: JobName;
  dispatch: DispatchFn;
}>;

export type JobRegistry = ReadonlyMap<JobName, AnyJob>;

export function defineJob<TPayload>(
  input: Readonly<{
    name: string;
    payloadSchema: z.ZodType<TPayload>;
    handle: JobHandler<TPayload>;
  }>,
): Job<TPayload> {
  const dispatch: DispatchFn = async (rawPayload, context) => {
    const parsed = input.payloadSchema.safeParse(rawPayload);

    if (!parsed.success) {
      return {
        ok: false,
        reason: parsed.error.issues
          .map(
            (issue) => `${issue.path.join(".") || "payload"}: ${issue.message}`,
          )
          .join("; "),
      };
    }

    await input.handle(parsed.data, context);

    return { ok: true };
  };

  return {
    name: jobName(input.name),
    payloadSchema: input.payloadSchema,
    handle: input.handle,
    dispatch,
  };
}

export function createJobRegistry(jobs: readonly AnyJob[]): JobRegistry {
  const registry = new Map<JobName, AnyJob>();

  for (const job of jobs) {
    if (registry.has(job.name)) {
      throw new Error(`Job "${job.name}" is registered twice`);
    }

    registry.set(job.name, job);
  }

  return registry;
}
