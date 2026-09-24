import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanAuthTables,
  TEST_TOKEN_INSTANT,
} from "../../../test/auth-fixtures";
import { capturingLogger, type LogLine } from "../../../test/queue-fixtures";
import {
  db,
  fileRow,
  seedFile,
  seedImageUser,
  stubSignedFetch,
} from "../../../test/profile-image-fixtures";
import { fixedClock } from "../../platform/clock/clock";
import {
  createObjectStorage,
  type ObjectStorageHandle,
} from "../../platform/storage/presign";
import { createProfileImageJobs } from "./profile-image.jobs";

const CONTEXT = {
  jobId: "users.profileImage.expireUpload-1",
  traceId: "trace-1",
  attempt: 1,
  enqueuedAt: TEST_TOKEN_INSTANT.toISOString(),
};
const EXPIRES_AT = new Date(TEST_TOKEN_INSTANT.getTime() + 7_200_000);

function configuredStorage(): ObjectStorageHandle {
  return {
    bucket: "cf-core-kit-dev",
    storage: createObjectStorage(
      {
        accountId: "00000000000000000000000000000000",
        bucket: "cf-core-kit-dev",
        accessKeyId: "CFEXAMPLEKEY12345",
        secretAccessKey: "c2VjcmV0LXRlc3Qta2V5",
      },
      fixedClock(TEST_TOKEN_INSTANT),
    ),
  };
}

function jobDeps(objectStorage?: ObjectStorageHandle): {
  jobs: ReturnType<typeof createProfileImageJobs>;
  lines: LogLine[];
} {
  const lines: LogLine[] = [];

  return {
    lines,
    jobs: createProfileImageJobs({
      db: db(),
      clock: fixedClock(TEST_TOKEN_INSTANT),
      logger: capturingLogger(lines),
      ...(objectStorage === undefined ? {} : { objectStorage }),
    }),
  };
}

describe("users.profileImage.expireUpload", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes the object and marks the row deleted", async () => {
    const userId = await seedImageUser();
    const fileId = await seedFile(userId);
    const calls = stubSignedFetch(() => new Response(null, { status: 204 }));
    const { jobs, lines } = jobDeps(configuredStorage());

    await jobs.expireUpload.handle(
      {
        fileId,
        ownerUserId: userId,
        enqueuedAt: TEST_TOKEN_INSTANT.toISOString(),
        expiresAt: EXPIRES_AT.toISOString(),
      },
      CONTEXT,
    );

    expect(calls.map((call) => call.method)).toEqual(["DELETE"]);
    const row = await fileRow(fileId);
    expect(row.status).toBe("DELETED");
    expect(row.deletedAt?.getTime()).toBe(TEST_TOKEN_INSTANT.getTime());
    expect(lines.at(-1)?.message).toBe("profile image upload expired");
    expect(lines.at(-1)?.fields.outcome).toBe("expired");
  });

  it("still marks the row deleted without storage and skips other states", async () => {
    const userId = await seedImageUser();
    const uploading = await seedFile(userId);
    const active = await seedFile(userId, { status: "ACTIVE" });
    const { jobs, lines } = jobDeps();

    await jobs.expireUpload.handle(
      {
        fileId: uploading,
        ownerUserId: userId,
        enqueuedAt: TEST_TOKEN_INSTANT.toISOString(),
        expiresAt: EXPIRES_AT.toISOString(),
      },
      CONTEXT,
    );
    await jobs.expireUpload.handle(
      {
        fileId: active,
        ownerUserId: userId,
        enqueuedAt: TEST_TOKEN_INSTANT.toISOString(),
        expiresAt: EXPIRES_AT.toISOString(),
      },
      CONTEXT,
    );
    await jobs.expireUpload.handle(
      {
        fileId: crypto.randomUUID(),
        ownerUserId: userId,
        enqueuedAt: TEST_TOKEN_INSTANT.toISOString(),
        expiresAt: EXPIRES_AT.toISOString(),
      },
      CONTEXT,
    );

    expect((await fileRow(uploading)).status).toBe("DELETED");
    expect((await fileRow(active)).status).toBe("ACTIVE");
    expect(
      lines.filter((line) => line.message === "profile image expiry skipped"),
    ).toHaveLength(2);
    expect(lines.at(-1)?.fields.reason).toBe("file_not_found");
  });
});

describe("users.profileImage.deleteStoredFile", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes the object and the row", async () => {
    const userId = await seedImageUser();
    const fileId = await seedFile(userId, { status: "ACTIVE" });
    const calls = stubSignedFetch(() => new Response(null, { status: 204 }));
    const { jobs, lines } = jobDeps(configuredStorage());

    await jobs.deleteStoredFile.handle(
      {
        fileId,
        ownerUserId: userId,
        enqueuedAt: TEST_TOKEN_INSTANT.toISOString(),
      },
      CONTEXT,
    );

    expect(calls.map((call) => call.method)).toEqual(["DELETE"]);
    expect((await fileRow(fileId)).status).toBe("DELETED");
    expect(lines.at(-1)?.fields.outcome).toBe("deleted");
  });

  it("deletes the object for a row the lifecycle already retired", async () => {
    const userId = await seedImageUser();
    const retired = await seedFile(userId, { status: "DELETED" });
    const calls = stubSignedFetch(() => new Response(null, { status: 204 }));
    const { jobs, lines } = jobDeps(configuredStorage());

    await jobs.deleteStoredFile.handle(
      {
        fileId: retired,
        ownerUserId: userId,
        enqueuedAt: TEST_TOKEN_INSTANT.toISOString(),
      },
      CONTEXT,
    );

    expect(calls.map((call) => call.method)).toEqual(["DELETE"]);
    expect(lines.at(-1)?.fields.outcome).toBe("deleted");
  });

  it("skips cleanup only when storage is unconfigured or the row is gone", async () => {
    const userId = await seedImageUser();
    const active = await seedFile(userId, { status: "ACTIVE" });
    const calls = stubSignedFetch(() => new Response(null, { status: 204 }));
    const { jobs, lines } = jobDeps();

    await jobs.deleteStoredFile.handle(
      {
        fileId: active,
        ownerUserId: userId,
        enqueuedAt: TEST_TOKEN_INSTANT.toISOString(),
      },
      CONTEXT,
    );
    await jobs.deleteStoredFile.handle(
      {
        fileId: crypto.randomUUID(),
        ownerUserId: userId,
        enqueuedAt: TEST_TOKEN_INSTANT.toISOString(),
      },
      CONTEXT,
    );

    expect(calls).toHaveLength(0);
    expect((await fileRow(active)).status).toBe("ACTIVE");
    const skips = lines.filter(
      (line) => line.message === "profile image cleanup skipped",
    );
    expect(skips.map((line) => line.fields.reason)).toEqual([
      "storage_not_configured",
      "file_not_found",
    ]);
  });
});
