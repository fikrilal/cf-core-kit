import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanAuthTables,
  TEST_TOKEN_INSTANT,
} from "../../../../test/auth-fixtures";
import { fakeQueue } from "../../../../test/queue-fixtures";
import {
  db,
  fileRow,
  headOk,
  imageRequest,
  pointUserAt,
  seedFile,
  seedImageUser,
  stubSignedFetch,
} from "../../../../test/profile-image-fixtures";
import { storedFiles, users } from "../../../platform/db/schema";

const COMPLETE_PATH = "/v1/me/profile-image/complete";

function complete(
  userId: string,
  body: Record<string, unknown>,
  queue?: Queue,
) {
  return imageRequest(COMPLETE_PATH, "POST", userId, { body, queue });
}

describe("users.me.profileImage.complete", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the object, points the user at it, and retires the previous file", async () => {
    const userId = await seedImageUser();
    const previous = await seedFile(userId, {
      status: "ACTIVE",
      uploadedAt: new Date(TEST_TOKEN_INSTANT.getTime() - 1_000),
    });
    await pointUserAt(userId, previous);
    const fileId = await seedFile(userId);
    const { queue, sent } = fakeQueue();
    const calls = stubSignedFetch(() => headOk(4, "image/webp"));

    const response = await complete(userId, { fileId }, queue);

    expect(response.status).toBe(204);
    const row = await fileRow(fileId);
    expect(row.status).toBe("ACTIVE");
    expect(row.uploadedAt?.getTime()).toBe(TEST_TOKEN_INSTANT.getTime());

    const userRows = await db()
      .select()
      .from(users)
      .where(eq(users.id, userId));
    expect(userRows[0]?.profileImageFileId).toBe(fileId);

    const previousRow = await fileRow(previous);
    expect(previousRow.status).toBe("DELETED");
    expect(previousRow.deletedAt?.getTime()).toBe(TEST_TOKEN_INSTANT.getTime());

    expect(calls.map((call) => call.method)).toEqual(["HEAD"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({
      job: "users.profileImage.deleteStoredFile",
      payload: { fileId: previous, ownerUserId: userId },
    });
  });

  it("is a no-op when the file is already attached", async () => {
    const userId = await seedImageUser();
    const fileId = await seedFile(userId, {
      status: "ACTIVE",
      uploadedAt: new Date(TEST_TOKEN_INSTANT.getTime() - 1_000),
    });
    await pointUserAt(userId, fileId);
    const calls = stubSignedFetch(() => headOk(4, "image/webp"));

    const response = await complete(userId, { fileId });

    expect(response.status).toBe(204);
    expect(calls).toHaveLength(0);
  });
});

describe("users.me.profileImage.complete rejections", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 404 for unknown and foreign files", async () => {
    const userId = await seedImageUser();
    const otherUserId = await seedImageUser();
    const foreign = await seedFile(otherUserId);
    stubSignedFetch(() => headOk(4, "image/webp"));

    const unknown = await complete(userId, {
      fileId: crypto.randomUUID(),
    });
    const foreignResponse = await complete(userId, { fileId: foreign });

    expect(unknown.status).toBe(404);
    expect(foreignResponse.status).toBe(404);
  });

  it("rejects a missing object as USERS_PROFILE_IMAGE_NOT_UPLOADED", async () => {
    const userId = await seedImageUser();
    const fileId = await seedFile(userId);
    stubSignedFetch(() => new Response(null, { status: 404 }));

    const response = await complete(userId, { fileId });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USERS_PROFILE_IMAGE_NOT_UPLOADED",
    });
    expect((await fileRow(fileId)).status).toBe("UPLOADING");
  });

  it("rejects a deleted row without touching storage", async () => {
    const userId = await seedImageUser();
    const fileId = await seedFile(userId, { status: "DELETED" });
    const calls = stubSignedFetch(() => headOk(4, "image/webp"));

    const response = await complete(userId, { fileId });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USERS_PROFILE_IMAGE_NOT_UPLOADED",
    });
    expect(calls).toHaveLength(0);
  });

  it("rejects size and content-type mismatches, deleting the object", async () => {
    const userId = await seedImageUser();
    const wrongSize = await seedFile(userId, { sizeBytes: 10 });
    const wrongType = await seedFile(userId);
    const calls = stubSignedFetch((input) =>
      input.method === "HEAD"
        ? headOk(4, "image/png")
        : new Response(null, { status: 204 }),
    );

    const sizeResponse = await complete(userId, { fileId: wrongSize });
    const typeResponse = await complete(userId, { fileId: wrongType });

    expect(sizeResponse.status).toBe(409);
    await expect(sizeResponse.json()).resolves.toMatchObject({
      code: "USERS_PROFILE_IMAGE_SIZE_MISMATCH",
    });
    expect(typeResponse.status).toBe(409);
    await expect(typeResponse.json()).resolves.toMatchObject({
      code: "USERS_PROFILE_IMAGE_CONTENT_TYPE_MISMATCH",
    });
    expect((await fileRow(wrongSize)).status).toBe("DELETED");
    expect((await fileRow(wrongType)).status).toBe("DELETED");
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(2);
    const remaining = await db().select().from(storedFiles);
    expect(remaining).toHaveLength(2);
  });
});
