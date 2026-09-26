import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authEnv,
  cleanAuthTables,
  jsonRecord,
  TEST_TOKEN_INSTANT,
} from "../../../../test/auth-fixtures";
import { fakeQueue } from "../../../../test/queue-fixtures";
import {
  db,
  fileRow,
  imageRequest,
  pointUserAt,
  seedFile,
  seedImageUser,
} from "../../../../test/profile-image-fixtures";
import { users } from "../../../platform/db/schema";

const CLEAR_PATH = "/v1/me/profile-image";
const URL_PATH = "/v1/me/profile-image/url";
const GET_URL_EXPIRES_AT = new Date(TEST_TOKEN_INSTANT.getTime() + 900_000);

describe("users.me.profileImage.clear", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("clears the image, retires the row, and enqueues cleanup", async () => {
    const userId = await seedImageUser();
    const fileId = await seedFile(userId, {
      status: "ACTIVE",
      uploadedAt: new Date(TEST_TOKEN_INSTANT.getTime() - 1_000),
    });
    await pointUserAt(userId, fileId);
    const { queue, sent } = fakeQueue();

    const response = await imageRequest(CLEAR_PATH, "DELETE", userId, {
      queue,
    });

    expect(response.status).toBe(204);
    const rows = await db().select().from(users).where(eq(users.id, userId));
    expect(rows[0]?.profileImageFileId).toBeNull();
    expect((await fileRow(fileId)).status).toBe("DELETED");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({
      job: "users.profileImage.deleteStoredFile",
      payload: { fileId, ownerUserId: userId },
    });
  });

  it("is idempotent, needs no storage, and enqueues nothing without an image", async () => {
    const userId = await seedImageUser();
    const { queue, sent } = fakeQueue();

    const first = await imageRequest(CLEAR_PATH, "DELETE", userId, {
      queue,
      env: authEnv(),
    });
    const second = await imageRequest(CLEAR_PATH, "DELETE", userId, {
      queue,
      env: authEnv(),
    });

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(sent).toHaveLength(0);
  });
});

describe("users.me.profileImage.url", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("answers 204 without an image and 200 with a signed URL otherwise", async () => {
    const userId = await seedImageUser();

    const none = await imageRequest(URL_PATH, "GET", userId);
    expect(none.status).toBe(204);

    const fileId = await seedFile(userId, {
      status: "ACTIVE",
      uploadedAt: new Date(TEST_TOKEN_INSTANT.getTime() - 1_000),
    });
    await pointUserAt(userId, fileId);

    const response = await imageRequest(URL_PATH, "GET", userId);
    expect(response.status).toBe(200);
    const body = await jsonRecord(response);
    const data = body.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error("expected a data object");
    }
    const record: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) record[key] = value;

    const signed = new URL(String(record.url));
    expect(signed.pathname).toContain(
      `/cf-core-kit-dev/users/${userId}/profile-images/${fileId}`,
    );
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(record.expiresAt).toBe(GET_URL_EXPIRES_AT.toISOString());
  });

  it("still answers 204 without an image when storage is unconfigured, else 501", async () => {
    const userId = await seedImageUser();

    const none = await imageRequest(URL_PATH, "GET", userId, {
      env: authEnv(),
    });
    expect(none.status).toBe(204);

    const fileId = await seedFile(userId, {
      status: "ACTIVE",
      uploadedAt: new Date(TEST_TOKEN_INSTANT.getTime() - 1_000),
    });
    await pointUserAt(userId, fileId);

    const withImage = await imageRequest(URL_PATH, "GET", userId, {
      env: authEnv(),
    });
    expect(withImage.status).toBe(501);
    await expect(withImage.json()).resolves.toMatchObject({
      code: "USERS_OBJECT_STORAGE_NOT_CONFIGURED",
    });
  });
});
