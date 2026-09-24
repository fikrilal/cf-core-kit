import type { Clock } from "../../platform/clock/clock";
import type { Database } from "../../platform/db/db";
import type { Logger } from "../../platform/logging/logger";
import type { ObjectStorageHandle } from "../../platform/storage/presign";
import type { PROFILE_IMAGE_CONTENT_TYPES } from "../../shared/contract/users";
import {
  attachProfileImageFile,
  createStoredFile,
  findStoredFileForOwner,
  getCurrentProfileImageFile,
  markStoredFileDeleted,
  type StoredFileRow,
} from "./profile-image.repository";

export const PROFILE_IMAGE_PRESIGN_TTL_SECONDS = 600;
export const PROFILE_IMAGE_GET_URL_TTL_SECONDS = 900;

export type ProfileImageContentType =
  (typeof PROFILE_IMAGE_CONTENT_TYPES)[number];

export type ProfileImageServiceDependencies = Readonly<{
  db: Database;
  clock: Clock;
  storage: ObjectStorageHandle;
  logger: Logger;
}>;

export type UploadPlan = Readonly<{
  fileId: string;
  upload: Readonly<{
    method: "PUT";
    url: string;
    headers: Readonly<Record<string, string>>;
  }>;
  expiresAt: string;
}>;

export async function createUploadPlan(
  dependencies: ProfileImageServiceDependencies,
  input: Readonly<{
    userId: string;
    contentType: ProfileImageContentType;
    sizeBytes: number;
    traceId: string | undefined;
  }>,
): Promise<UploadPlan | "not_found"> {
  const now = dependencies.clock.now();
  const fileId = crypto.randomUUID();
  const objectKey = `users/${input.userId}/profile-images/${fileId}`;
  const presigned = await dependencies.storage.storage.presignPutObject({
    key: objectKey,
    contentType: input.contentType,
    expiresInSeconds: PROFILE_IMAGE_PRESIGN_TTL_SECONDS,
  });
  const created = await createStoredFile(dependencies.db, {
    id: fileId,
    ownerUserId: input.userId,
    bucket: dependencies.storage.bucket,
    objectKey,
    contentType: input.contentType,
    sizeBytes: Math.trunc(input.sizeBytes),
    traceId: input.traceId,
    now,
  });

  if (created === "not_found") return "not_found";

  return {
    fileId,
    upload: {
      method: "PUT",
      url: presigned.url,
      headers: presigned.headers,
    },
    expiresAt: new Date(
      now.getTime() + PROFILE_IMAGE_PRESIGN_TTL_SECONDS * 1000,
    ).toISOString(),
  };
}

export type CompleteUploadResult =
  | Readonly<{ kind: "attached"; previousFileId: string | null }>
  | Readonly<{ kind: "noop" }>
  | Readonly<{ kind: "not_found" }>
  | Readonly<{ kind: "not_uploaded" }>
  | Readonly<{ kind: "size_mismatch" }>
  | Readonly<{ kind: "content_type_mismatch" }>;

async function rejectUpload(
  dependencies: ProfileImageServiceDependencies,
  row: StoredFileRow,
  now: Date,
): Promise<void> {
  try {
    await dependencies.storage.storage.deleteObject(row.objectKey);
  } catch (error) {
    dependencies.logger.warn("profile image object delete failed", {
      fileId: row.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await markStoredFileDeleted(dependencies.db, row.id, now);
}

export async function completeUpload(
  dependencies: ProfileImageServiceDependencies,
  input: Readonly<{ userId: string; fileId: string }>,
): Promise<CompleteUploadResult> {
  const row = await findStoredFileForOwner(
    dependencies.db,
    input.fileId,
    input.userId,
  );

  if (row === undefined) return { kind: "not_found" };
  if (row.status === "DELETED") return { kind: "not_uploaded" };

  const current = await getCurrentProfileImageFile(
    dependencies.db,
    input.userId,
  );
  if (
    row.status === "ACTIVE" &&
    row.uploadedAt !== null &&
    current?.id === input.fileId
  ) {
    return { kind: "noop" };
  }

  const head = await dependencies.storage.storage.headObject(row.objectKey);

  if (!head.exists) return { kind: "not_uploaded" };

  if (head.contentLength !== row.sizeBytes) {
    await rejectUpload(dependencies, row, dependencies.clock.now());

    return { kind: "size_mismatch" };
  }

  if (head.contentType !== row.contentType) {
    await rejectUpload(dependencies, row, dependencies.clock.now());

    return { kind: "content_type_mismatch" };
  }

  const attached = await attachProfileImageFile(dependencies.db, {
    userId: input.userId,
    fileId: input.fileId,
    now: dependencies.clock.now(),
  });

  if (attached.kind === "not_found") return { kind: "not_found" };

  return { kind: "attached", previousFileId: attached.previousFileId };
}
