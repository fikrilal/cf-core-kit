import { z } from "zod";

import type { Clock } from "../../../platform/clock/clock";
import type { Database } from "../../../platform/db/db";
import type { Logger } from "../../../platform/logging/logger";
import { createQueueProducer } from "../../../platform/queue/producer";
import { defineJob, type Job } from "../../../platform/queue/registry";
import type { ObjectStorageHandle } from "../../../platform/storage/presign";
import {
  findStoredFileById,
  markStoredFileDeleted,
} from "./profile-image.repository";

export const PROFILE_IMAGE_DELETE_STORED_FILE_JOB =
  "users.profileImage.deleteStoredFile";
export const PROFILE_IMAGE_EXPIRE_UPLOAD_JOB =
  "users.profileImage.expireUpload";
export const PROFILE_IMAGE_UPLOAD_EXPIRE_DELAY_SECONDS = 7_200;

export const deleteStoredFilePayloadSchema = z.object({
  fileId: z.string().min(1),
  ownerUserId: z.string().min(1),
  enqueuedAt: z.iso.datetime(),
});

export const expireUploadPayloadSchema = z.object({
  fileId: z.string().min(1),
  ownerUserId: z.string().min(1),
  enqueuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export type DeleteStoredFilePayload = z.infer<
  typeof deleteStoredFilePayloadSchema
>;
export type ExpireUploadPayload = z.infer<typeof expireUploadPayloadSchema>;

export type ProfileImageJobDependencies = Readonly<{
  db: Database;
  clock: Clock;
  logger: Logger;
  objectStorage?: ObjectStorageHandle;
}>;

export type ProfileImageJobs = Readonly<{
  deleteStoredFile: Job<DeleteStoredFilePayload>;
  expireUpload: Job<ExpireUploadPayload>;
}>;

async function deleteObjectIfPossible(
  dependencies: ProfileImageJobDependencies,
  objectKey: string,
): Promise<boolean> {
  if (dependencies.objectStorage === undefined) return false;

  await dependencies.objectStorage.storage.deleteObject(objectKey);

  return true;
}

function createDeleteStoredFileJob(
  dependencies: ProfileImageJobDependencies,
): Job<DeleteStoredFilePayload> {
  return defineJob({
    name: PROFILE_IMAGE_DELETE_STORED_FILE_JOB,
    payloadSchema: deleteStoredFilePayloadSchema,
    handle: async (payload, context) => {
      const row = await findStoredFileById(dependencies.db, payload.fileId);

      if (row === undefined) {
        dependencies.logger.info("profile image cleanup skipped", {
          jobId: context.jobId,
          traceId: context.traceId,
          fileId: payload.fileId,
          reason: "file_not_found",
        });

        return;
      }

      if (!(await deleteObjectIfPossible(dependencies, row.objectKey))) {
        dependencies.logger.warn("profile image cleanup skipped", {
          jobId: context.jobId,
          traceId: context.traceId,
          fileId: payload.fileId,
          reason: "storage_not_configured",
        });

        return;
      }

      await markStoredFileDeleted(
        dependencies.db,
        row.id,
        dependencies.clock.now(),
      );
      dependencies.logger.info("profile image cleanup complete", {
        jobId: context.jobId,
        traceId: context.traceId,
        fileId: row.id,
        outcome: "deleted",
      });
    },
  });
}

function createExpireUploadJob(
  dependencies: ProfileImageJobDependencies,
): Job<ExpireUploadPayload> {
  return defineJob({
    name: PROFILE_IMAGE_EXPIRE_UPLOAD_JOB,
    payloadSchema: expireUploadPayloadSchema,
    handle: async (payload, context) => {
      const row = await findStoredFileById(dependencies.db, payload.fileId);

      if (row?.status !== "UPLOADING") {
        dependencies.logger.info("profile image expiry skipped", {
          jobId: context.jobId,
          traceId: context.traceId,
          fileId: payload.fileId,
          reason: row === undefined ? "file_not_found" : "not_uploading",
        });

        return;
      }

      const deletedObject = await deleteObjectIfPossible(
        dependencies,
        row.objectKey,
      );

      await markStoredFileDeleted(
        dependencies.db,
        row.id,
        dependencies.clock.now(),
      );
      dependencies.logger.info("profile image upload expired", {
        jobId: context.jobId,
        traceId: context.traceId,
        fileId: row.id,
        expiresAt: payload.expiresAt,
        outcome: deletedObject ? "expired" : "storage_not_configured",
      });
    },
  });
}

export function createProfileImageJobs(
  dependencies: ProfileImageJobDependencies,
): ProfileImageJobs {
  return {
    deleteStoredFile: createDeleteStoredFileJob(dependencies),
    expireUpload: createExpireUploadJob(dependencies),
  };
}

export type ProfileImageCleanupProducer = Readonly<{
  enqueueDeleteStoredFile: (input: {
    userId: string;
    fileId: string;
  }) => Promise<boolean>;
  enqueueExpireUpload: (input: {
    userId: string;
    fileId: string;
    expiresAt: string;
  }) => Promise<boolean>;
}>;

export function createProfileImageCleanupProducer(
  dependencies: Readonly<{ queue: Queue; clock: Clock; logger: Logger }>,
): ProfileImageCleanupProducer {
  const producer = createQueueProducer(dependencies);

  return {
    enqueueDeleteStoredFile: (input) =>
      producer.enqueue(
        {
          name: PROFILE_IMAGE_DELETE_STORED_FILE_JOB,
          payloadSchema: deleteStoredFilePayloadSchema,
        },
        {
          fileId: input.fileId,
          ownerUserId: input.userId,
          enqueuedAt: dependencies.clock.now().toISOString(),
        },
        { jobId: `${PROFILE_IMAGE_DELETE_STORED_FILE_JOB}-${input.fileId}` },
      ),
    enqueueExpireUpload: (input) =>
      producer.enqueue(
        {
          name: PROFILE_IMAGE_EXPIRE_UPLOAD_JOB,
          payloadSchema: expireUploadPayloadSchema,
        },
        {
          fileId: input.fileId,
          ownerUserId: input.userId,
          enqueuedAt: dependencies.clock.now().toISOString(),
          expiresAt: input.expiresAt,
        },
        {
          jobId: `${PROFILE_IMAGE_EXPIRE_UPLOAD_JOB}-${input.fileId}`,
          delaySeconds: PROFILE_IMAGE_UPLOAD_EXPIRE_DELAY_SECONDS,
        },
      ),
  };
}
