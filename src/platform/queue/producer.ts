import type { Clock } from "../clock/clock";
import { randomBase64Url } from "../crypto/crypto";
import type { Logger } from "../logging/logger";
import {
  JOB_ENVELOPE_VERSION,
  MAX_JOB_ID_LENGTH,
  MAX_TRACE_ID_LENGTH,
  type JobEnvelope,
} from "./job";
import { MAX_MESSAGE_DELAY_SECONDS } from "./defaults";
import type { JobSpec } from "./registry";

export type EnqueueOptions = Readonly<{
  jobId?: string;
  traceId?: string;
  delaySeconds?: number;
}>;

export type QueueProducer = Readonly<{
  enqueue: <TPayload>(
    job: JobSpec<TPayload>,
    payload: TPayload,
    options?: EnqueueOptions,
  ) => Promise<boolean>;
}>;

export type QueueProducerInput = Readonly<{
  queue: Queue;
  clock: Clock;
  logger: Logger;
}>;

function resolveIdentifiers(
  jobName: string,
  options: EnqueueOptions,
  logger: Logger,
): Readonly<{ jobId: string; traceId: string }> | undefined {
  const jobId = options.jobId ?? `${jobName}-${randomBase64Url(12)}`;
  const traceId = options.traceId ?? jobId;

  if (
    jobId.length === 0 ||
    traceId.length === 0 ||
    jobId.length > MAX_JOB_ID_LENGTH ||
    traceId.length > MAX_TRACE_ID_LENGTH
  ) {
    logger.error("job identifier invalid", {
      job: jobName,
      jobIdLength: jobId.length,
      traceIdLength: traceId.length,
    });

    return undefined;
  }

  return { jobId, traceId };
}

function resolveDelay(
  jobName: string,
  options: EnqueueOptions,
  logger: Logger,
): number | undefined {
  const delaySeconds = options.delaySeconds ?? 0;

  if (
    !Number.isInteger(delaySeconds) ||
    delaySeconds < 0 ||
    delaySeconds > MAX_MESSAGE_DELAY_SECONDS
  ) {
    logger.error("job delay out of range", {
      job: jobName,
      delaySeconds,
      maxDelaySeconds: MAX_MESSAGE_DELAY_SECONDS,
    });

    return undefined;
  }

  return delaySeconds;
}

export function createQueueProducer(input: QueueProducerInput): QueueProducer {
  const { clock, logger } = input;

  const enqueue = async <TPayload>(
    job: JobSpec<TPayload>,
    payload: TPayload,
    options: EnqueueOptions = {},
  ): Promise<boolean> => {
    const parsed = job.payloadSchema.safeParse(payload);

    if (!parsed.success) {
      logger.error("job payload rejected", {
        job: job.name,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });

      return false;
    }

    const delaySeconds = resolveDelay(job.name, options, logger);

    if (delaySeconds === undefined) {
      return false;
    }

    const identifiers = resolveIdentifiers(job.name, options, logger);

    if (identifiers === undefined) {
      return false;
    }

    const { jobId, traceId } = identifiers;

    const envelope: JobEnvelope = {
      v: JOB_ENVELOPE_VERSION,
      job: job.name,
      jobId,
      traceId,
      enqueuedAt: clock.now().toISOString(),
      payload: parsed.data,
    };

    try {
      await input.queue.send(
        envelope,
        delaySeconds === 0 ? undefined : { delaySeconds },
      );
    } catch (error) {
      logger.error("job enqueue failed", {
        job: job.name,
        jobId,
        traceId,
        error: error instanceof Error ? error.message : String(error),
      });

      return false;
    }

    logger.info("job enqueued", {
      job: job.name,
      jobId,
      traceId,
      ...(delaySeconds === 0 ? {} : { delaySeconds }),
    });

    return true;
  };

  return { enqueue };
}
