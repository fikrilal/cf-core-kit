import { jobEnvelopeSchema, type JobEnvelope } from "./job";
import { retryDelaySeconds } from "./defaults";
import type { JobContext, JobRegistry } from "./registry";
import type { Logger } from "../logging/logger";

export type MessageOutcome = "acked" | "retried" | "discarded";

export type BatchResult = Readonly<{
  queue: string;
  acked: number;
  retried: number;
  discarded: number;
}>;

export type QueueConsumer = (batch: MessageBatch) => Promise<BatchResult>;

export type QueueConsumerInput = Readonly<{
  registry: JobRegistry;
  logger: Logger;
}>;

export type DeadLetterConsumer = (batch: MessageBatch) => Promise<BatchResult>;

type EnvelopeResult =
  | Readonly<{ ok: true; envelope: JobEnvelope }>
  | Readonly<{ ok: false; reason: string }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseEnvelope(body: unknown): EnvelopeResult {
  const parsed = jobEnvelopeSchema.safeParse(body);

  if (parsed.success) {
    return { ok: true, envelope: parsed.data };
  }

  const [issue] = parsed.error.issues;
  const path = issue === undefined ? "envelope" : issue.path.join(".");
  const message = issue === undefined ? "invalid envelope" : issue.message;

  return { ok: false, reason: `${path || "envelope"}: ${message}` };
}

function contextFor(envelope: JobEnvelope, attempt: number): JobContext {
  return {
    jobId: envelope.jobId,
    traceId: envelope.traceId,
    attempt,
    enqueuedAt: envelope.enqueuedAt,
  };
}

async function processMessage(
  message: Message,
  queue: string,
  registry: JobRegistry,
  logger: Logger,
): Promise<MessageOutcome> {
  const parsed = parseEnvelope(message.body);

  if (!parsed.ok) {
    message.ack();
    logger.error("job envelope rejected", {
      queue,
      messageId: message.id,
      reason: parsed.reason,
    });

    return "discarded";
  }

  const { envelope } = parsed;
  const job = registry.get(envelope.job);

  if (job === undefined) {
    message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
    logger.error("unknown job", {
      queue,
      job: envelope.job,
      jobId: envelope.jobId,
      traceId: envelope.traceId,
      attempt: message.attempts,
    });

    return "retried";
  }

  try {
    const outcome = await job.dispatch(
      envelope.payload,
      contextFor(envelope, message.attempts),
    );

    if (!outcome.ok) {
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      logger.error("job payload rejected", {
        queue,
        job: envelope.job,
        jobId: envelope.jobId,
        traceId: envelope.traceId,
        reason: outcome.reason,
      });

      return "retried";
    }
  } catch (error) {
    message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
    logger.error("job failed", {
      queue,
      job: envelope.job,
      jobId: envelope.jobId,
      traceId: envelope.traceId,
      attempt: message.attempts,
      error: errorMessage(error),
    });

    return "retried";
  }

  message.ack();
  logger.debug("job processed", {
    queue,
    job: envelope.job,
    jobId: envelope.jobId,
    traceId: envelope.traceId,
  });

  return "acked";
}

export function createQueueConsumer(input: QueueConsumerInput): QueueConsumer {
  const { logger, registry } = input;

  return async (batch) => {
    const startedAt = Date.now();
    const counts: Record<MessageOutcome, number> = {
      acked: 0,
      retried: 0,
      discarded: 0,
    };

    for (const message of batch.messages) {
      try {
        counts[await processMessage(message, batch.queue, registry, logger)] +=
          1;
      } catch (error) {
        message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
        counts.retried += 1;
        logger.error("job failed", {
          queue: batch.queue,
          messageId: message.id,
          attempt: message.attempts,
          error: errorMessage(error),
        });
      }
    }

    logger.info("queue batch processed", {
      queue: batch.queue,
      acked: counts.acked,
      retried: counts.retried,
      discarded: counts.discarded,
      size: batch.messages.length,
      durationMs: Date.now() - startedAt,
    });

    return { queue: batch.queue, ...counts };
  };
}

export function createDeadLetterConsumer(input: {
  logger: Logger;
}): DeadLetterConsumer {
  const { logger } = input;

  return (batch) => {
    const startedAt = Date.now();

    for (const message of batch.messages) {
      const parsed = parseEnvelope(message.body);

      logger.error("dead letter received", {
        queue: batch.queue,
        messageId: message.id,
        attempt: message.attempts,
        ...(parsed.ok
          ? {
              job: parsed.envelope.job,
              jobId: parsed.envelope.jobId,
              traceId: parsed.envelope.traceId,
              enqueuedAt: parsed.envelope.enqueuedAt,
            }
          : { reason: parsed.reason }),
      });

      message.ack();
    }

    logger.info("queue batch processed", {
      queue: batch.queue,
      acked: 0,
      retried: 0,
      discarded: batch.messages.length,
      size: batch.messages.length,
      durationMs: Date.now() - startedAt,
    });

    return Promise.resolve({
      queue: batch.queue,
      acked: 0,
      retried: 0,
      discarded: batch.messages.length,
    });
  };
}
