import { z } from "zod";

import type { Clock } from "../../platform/clock/clock";
import type { Database } from "../../platform/db/db";
import type { Logger } from "../../platform/logging/logger";
import { SWEEP_BATCH_SIZE } from "../../platform/queue/defaults";
import {
  schedulePayloadSchema,
  type SchedulePayload,
} from "../../platform/queue/job";
import { createQueueProducer } from "../../platform/queue/producer";
import { defineJob, type Job } from "../../platform/queue/registry";
import {
  finalizeAccountDeletion,
  findDueAccountDeletions,
} from "./account-deletion.repository";
import { createProfileImageCleanupProducer } from "./profile-image.jobs";

export const FINALIZE_ACCOUNT_DELETION_JOB = "users.finalizeAccountDeletion";
export const FINALIZE_DUE_ACCOUNT_DELETIONS_JOB =
  "users.finalizeDueAccountDeletions";

export const finalizeAccountDeletionPayloadSchema = z.object({
  userId: z.string().min(1),
  scheduledFor: z.iso.datetime(),
});

export type FinalizeAccountDeletionPayload = z.infer<
  typeof finalizeAccountDeletionPayloadSchema
>;

export type AccountDeletionJobDependencies = Readonly<{
  db: Database;
  clock: Clock;
  logger: Logger;
  queue: Queue;
}>;

export type AccountDeletionJobs = Readonly<{
  finalizeAccountDeletion: Job<FinalizeAccountDeletionPayload>;
  finalizeDueAccountDeletions: Job<SchedulePayload>;
}>;

async function enqueueStoredFileCleanup(
  cleanup: ReturnType<typeof createProfileImageCleanupProducer>,
  dependencies: AccountDeletionJobDependencies,
  context: Readonly<{ jobId: string; traceId: string }>,
  input: Readonly<{ userId: string; fileIds: readonly string[] }>,
): Promise<void> {
  for (const fileId of input.fileIds) {
    const queued = await cleanup.enqueueDeleteStoredFile({
      userId: input.userId,
      fileId,
    });

    if (!queued) {
      dependencies.logger.warn("profile image cleanup enqueue failed", {
        jobId: context.jobId,
        traceId: context.traceId,
        userId: input.userId,
        fileId,
      });
    }
  }
}

function createFinalizeAccountDeletionJob(
  dependencies: AccountDeletionJobDependencies,
  profileImageCleanup: ReturnType<typeof createProfileImageCleanupProducer>,
): Job<FinalizeAccountDeletionPayload> {
  return defineJob({
    name: FINALIZE_ACCOUNT_DELETION_JOB,
    payloadSchema: finalizeAccountDeletionPayloadSchema,
    handle: async (payload, context) => {
      const result = await finalizeAccountDeletion(dependencies.db, {
        userId: payload.userId,
        now: dependencies.clock.now(),
        traceId: context.traceId,
      });

      if (result.kind === "finalized") {
        await enqueueStoredFileCleanup(
          profileImageCleanup,
          dependencies,
          context,
          { userId: payload.userId, fileIds: result.clearedFileIds },
        );
      }

      if (result.kind === "blocked_last_admin") {
        dependencies.logger.warn("account deletion blocked", {
          jobId: context.jobId,
          traceId: context.traceId,
          userId: payload.userId,
          reason: "last_admin",
        });

        return;
      }

      dependencies.logger.info("account deletion finalized", {
        jobId: context.jobId,
        traceId: context.traceId,
        userId: payload.userId,
        outcome: result.kind,
        ...(result.kind === "skipped" ? { reason: result.reason } : {}),
        ...(result.kind === "not_due"
          ? { scheduledFor: result.scheduledFor.toISOString() }
          : {}),
      });
    },
  });
}

function createFinalizeDueAccountDeletionsJob(
  dependencies: AccountDeletionJobDependencies,
  producer: ReturnType<typeof createQueueProducer>,
): Job<SchedulePayload> {
  return defineJob({
    name: FINALIZE_DUE_ACCOUNT_DELETIONS_JOB,
    payloadSchema: schedulePayloadSchema,
    handle: async (payload, context) => {
      const due = await findDueAccountDeletions(dependencies.db, {
        now: dependencies.clock.now(),
        limit: SWEEP_BATCH_SIZE,
      });
      let enqueued = 0;

      for (const userId of due) {
        const queued = await producer.enqueue(
          {
            name: FINALIZE_ACCOUNT_DELETION_JOB,
            payloadSchema: finalizeAccountDeletionPayloadSchema,
          },
          {
            userId,
            scheduledFor: dependencies.clock.now().toISOString(),
          },
          {
            jobId: `${FINALIZE_ACCOUNT_DELETION_JOB}-${userId}`,
            traceId: context.traceId,
          },
        );

        if (queued) enqueued += 1;
      }

      dependencies.logger.info("due account deletions enqueued", {
        jobId: context.jobId,
        traceId: context.traceId,
        scheduledFor: payload.scheduledFor,
        due: due.length,
        enqueued,
      });
    },
  });
}

export function createAccountDeletionJobs(
  dependencies: AccountDeletionJobDependencies,
): AccountDeletionJobs {
  const producer = createQueueProducer({
    queue: dependencies.queue,
    clock: dependencies.clock,
    logger: dependencies.logger,
  });
  const profileImageCleanup = createProfileImageCleanupProducer({
    queue: dependencies.queue,
    clock: dependencies.clock,
    logger: dependencies.logger,
  });

  return {
    finalizeAccountDeletion: createFinalizeAccountDeletionJob(
      dependencies,
      profileImageCleanup,
    ),
    finalizeDueAccountDeletions: createFinalizeDueAccountDeletionsJob(
      dependencies,
      producer,
    ),
  };
}
