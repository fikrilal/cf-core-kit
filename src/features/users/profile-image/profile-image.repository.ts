import { and, eq, isNull, ne, or } from "drizzle-orm";

import type { Database } from "../../../platform/db/db";
import { runBatch } from "../../../platform/db/db";
import { storedFiles, users } from "../../../platform/db/schema";

export type StoredFileRow = typeof storedFiles.$inferSelect;

export const PROFILE_IMAGE_PURPOSE = "PROFILE_IMAGE" as const;

export type CreateStoredFileInput = Readonly<{
  id: string;
  ownerUserId: string;
  bucket: string;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  traceId: string | undefined;
  now: Date;
}>;

export async function createStoredFile(
  db: Database,
  input: CreateStoredFileInput,
): Promise<"ok" | "not_found"> {
  const user = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, input.ownerUserId))
    .get();

  if (user === undefined || user.status === "DELETED") return "not_found";

  await db.insert(storedFiles).values({
    id: input.id,
    ownerUserId: input.ownerUserId,
    purpose: PROFILE_IMAGE_PURPOSE,
    status: "UPLOADING",
    bucket: input.bucket,
    objectKey: input.objectKey,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    uploadedAt: null,
    deletedAt: null,
    traceId: input.traceId ?? null,
    createdAt: input.now,
    updatedAt: input.now,
  });

  return "ok";
}

export async function findStoredFileForOwner(
  db: Database,
  fileId: string,
  ownerUserId: string,
): Promise<StoredFileRow | undefined> {
  return db
    .select()
    .from(storedFiles)
    .where(
      and(
        eq(storedFiles.id, fileId),
        eq(storedFiles.ownerUserId, ownerUserId),
        eq(storedFiles.purpose, PROFILE_IMAGE_PURPOSE),
      ),
    )
    .get();
}

export async function findStoredFileById(
  db: Database,
  id: string,
): Promise<StoredFileRow | undefined> {
  return db.select().from(storedFiles).where(eq(storedFiles.id, id)).get();
}

export async function markStoredFileDeleted(
  db: Database,
  id: string,
  now: Date,
): Promise<void> {
  await db
    .update(storedFiles)
    .set({ status: "DELETED", deletedAt: now, updatedAt: now })
    .where(and(eq(storedFiles.id, id), ne(storedFiles.status, "DELETED")));
}

export async function getCurrentProfileImageFile(
  db: Database,
  userId: string,
): Promise<StoredFileRow | undefined> {
  const user = await db
    .select({ profileImageFileId: users.profileImageFileId })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  const fileId = user?.profileImageFileId ?? null;

  if (fileId === null) return undefined;

  return db
    .select()
    .from(storedFiles)
    .where(
      and(
        eq(storedFiles.id, fileId),
        eq(storedFiles.purpose, PROFILE_IMAGE_PURPOSE),
        eq(storedFiles.status, "ACTIVE"),
      ),
    )
    .get();
}

export type AttachProfileImageResult =
  | Readonly<{ kind: "ok"; previousFileId: string | null }>
  | Readonly<{ kind: "not_found" }>;

export async function attachProfileImageFile(
  db: Database,
  input: Readonly<{ userId: string; fileId: string; now: Date }>,
): Promise<AttachProfileImageResult> {
  const user = await db
    .select({
      id: users.id,
      status: users.status,
      profileImageFileId: users.profileImageFileId,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .get();

  if (user === undefined || user.status === "DELETED") {
    return { kind: "not_found" };
  }

  const attachFile = db
    .update(storedFiles)
    .set({ status: "ACTIVE", uploadedAt: input.now, updatedAt: input.now })
    .where(
      and(
        eq(storedFiles.id, input.fileId),
        eq(storedFiles.ownerUserId, input.userId),
        ne(storedFiles.status, "DELETED"),
        or(eq(storedFiles.status, "UPLOADING"), isNull(storedFiles.uploadedAt)),
      ),
    );
  const pointUser = db
    .update(users)
    .set({ profileImageFileId: input.fileId, updatedAt: input.now })
    .where(eq(users.id, input.userId));
  const previousFileId = user.profileImageFileId;

  if (previousFileId !== null && previousFileId !== input.fileId) {
    const retirePrevious = db
      .update(storedFiles)
      .set({ status: "DELETED", deletedAt: input.now, updatedAt: input.now })
      .where(eq(storedFiles.id, previousFileId));

    await runBatch(db, [attachFile, pointUser, retirePrevious]);
  } else {
    await runBatch(db, [attachFile, pointUser]);
  }

  return { kind: "ok", previousFileId };
}

export type ClearProfileImageResult = Readonly<{
  clearedFileId: string | null;
}>;

export async function clearProfileImage(
  db: Database,
  input: Readonly<{ userId: string; now: Date }>,
): Promise<ClearProfileImageResult> {
  const user = await db
    .select({ profileImageFileId: users.profileImageFileId })
    .from(users)
    .where(eq(users.id, input.userId))
    .get();
  const fileId = user?.profileImageFileId ?? null;

  if (fileId === null) return { clearedFileId: null };

  await runBatch(db, [
    db
      .update(users)
      .set({ profileImageFileId: null, updatedAt: input.now })
      .where(eq(users.id, input.userId)),
    db
      .update(storedFiles)
      .set({ status: "DELETED", deletedAt: input.now, updatedAt: input.now })
      .where(
        and(eq(storedFiles.id, fileId), ne(storedFiles.status, "DELETED")),
      ),
  ]);

  return { clearedFileId: fileId };
}
