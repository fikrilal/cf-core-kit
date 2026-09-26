import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authEnv,
  cleanAuthTables,
  jsonRecord,
  TEST_TOKEN_INSTANT,
  userAccessToken,
} from "../../../../test/auth-fixtures";
import { send } from "../../../../test/app-request";
import { fakeQueue } from "../../../../test/queue-fixtures";
import { fixedClock } from "../../../platform/clock/clock";
import { createDb } from "../../../platform/db/db";
import { storedFiles, users } from "../../../platform/db/schema";
import { createApp } from "../../../platform/http/app";
import {
  durableObjectLimiterFactory,
  type LimiterFactory,
} from "../../../platform/rate-limit/require-rate-limit";
import type { RateLimitRequest } from "../../../platform/rate-limit/rate-limiter";
import { registerUsersRoutes } from "../users.routes";

const CLOCK = fixedClock(TEST_TOKEN_INSTANT);
const SEED_NOW = new Date(TEST_TOKEN_INSTANT.getTime() - 60_000);
const EXPIRES_AT = new Date(TEST_TOKEN_INSTANT.getTime() + 600_000);
const USER_EMAIL = "profile-image@example.com";

const R2_ENV = {
  ...authEnv(),
  R2_ACCESS_KEY_ID: "CFEXAMPLEKEY12345",
  R2_SECRET_ACCESS_KEY: "c2VjcmV0LXRlc3Qta2V5",
};

function db() {
  return createDb(env.DB);
}

function buildApp(
  options: { queue?: Queue; limiterFactory?: LimiterFactory } = {},
) {
  const app = createApp();

  registerUsersRoutes(app, {
    clock: CLOCK,
    queue: options.queue,
    rateLimiterFactory: options.limiterFactory ?? durableObjectLimiterFactory(),
  });

  return app;
}

async function seedUser(): Promise<string> {
  const id = crypto.randomUUID();

  await db().insert(users).values({
    id,
    email: USER_EMAIL,
    emailVerifiedAt: SEED_NOW,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });

  return id;
}

async function upload(
  userId: string,
  body: Record<string, unknown>,
  options: { queue?: Queue; limiterFactory?: LimiterFactory; env?: Env } = {},
) {
  const accessToken = await userAccessToken(userId, {
    now: TEST_TOKEN_INSTANT,
  });

  return send(
    buildApp(options),
    "https://example.com/v1/me/profile-image/upload",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
    options.env ?? R2_ENV,
  );
}

function recordingLimiter(lines: RateLimitRequest[]): LimiterFactory {
  return () => (input) => {
    lines.push(input);

    return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
  };
}

async function storedFileRow(fileId: string) {
  const rows = await db()
    .select()
    .from(storedFiles)
    .where(eq(storedFiles.id, fileId));
  const [row] = rows;
  if (row === undefined) throw new Error("expected a stored file row");

  return row;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected an object");
  }

  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) record[key] = entry;

  return record;
}

function expectUploadPlan(
  plan: Record<string, unknown>,
  userId: string,
): string {
  const fileId = String(plan.fileId);
  const presigned = readRecord(plan.upload);

  expect(fileId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  expect(presigned.method).toBe("PUT");
  expect(presigned.headers).toEqual({ "Content-Type": "image/webp" });
  const url = new URL(String(presigned.url));
  expect(url.pathname).toContain(
    `/cf-core-kit-dev/users/${userId}/profile-images/${fileId}`,
  );
  expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
  expect(plan.expiresAt).toBe(EXPIRES_AT.toISOString());

  return fileId;
}

describe("users.me.profileImage.upload", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 501 when object storage is not configured", async () => {
    const userId = await seedUser();

    const response = await upload(
      userId,
      { contentType: "image/webp", sizeBytes: 123 },
      { env: authEnv() },
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({
      code: "USERS_OBJECT_STORAGE_NOT_CONFIGURED",
    });
  });
});

describe("users.me.profileImage.upload plan", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("returns the upload plan, a stored-file row, and the expiry job", async () => {
    const userId = await seedUser();
    const { queue, sent } = fakeQueue();
    const limits: RateLimitRequest[] = [];

    const response = await upload(
      userId,
      { contentType: "image/webp", sizeBytes: 123_456 },
      { queue, limiterFactory: recordingLimiter(limits) },
    );

    expect(response.status).toBe(200);
    const body = await jsonRecord(response);
    const fileId = expectUploadPlan(readRecord(body.data), userId);

    const row = await storedFileRow(fileId);
    expect(row.ownerUserId).toBe(userId);
    expect(row.status).toBe("UPLOADING");
    expect(row.purpose).toBe("PROFILE_IMAGE");
    expect(row.bucket).toBe("cf-core-kit-dev");
    expect(row.objectKey).toBe(`users/${userId}/profile-images/${fileId}`);
    expect(row.contentType).toBe("image/webp");
    expect(row.sizeBytes).toBe(123_456);
    expect(row.uploadedAt).toBeNull();

    const userRows = await db()
      .select()
      .from(users)
      .where(eq(users.id, userId));
    expect(userRows[0]?.profileImageFileId).toBeNull();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.options).toEqual({ delaySeconds: 7200 });
    expect(sent[0]?.body).toMatchObject({
      job: "users.profileImage.expireUpload",
      payload: {
        fileId,
        ownerUserId: userId,
        enqueuedAt: TEST_TOKEN_INSTANT.toISOString(),
        expiresAt: EXPIRES_AT.toISOString(),
      },
    });

    expect(limits.map((line) => line.key)).toEqual([
      `users.profile-image.upload:user:${userId}`,
    ]);
    expect(limits[0]).toMatchObject({
      limit: 20,
      windowSeconds: 3600,
      blockSeconds: 900,
    });
  });
});

describe("users.me.profileImage.upload guards", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("truncates fractional sizes and validates the payload", async () => {
    const userId = await seedUser();
    const { queue } = fakeQueue();

    const truncated = await upload(
      userId,
      { contentType: "image/png", sizeBytes: 123.9 },
      { queue },
    );
    expect(truncated.status).toBe(200);
    const body = await jsonRecord(truncated);
    const data = body.data;
    const fileId =
      typeof data === "object" && data !== null && !Array.isArray(data)
        ? String(Object.entries(data)[0]?.[1])
        : "";
    expect(fileId.length).toBeGreaterThan(0);

    const badType = await upload(
      userId,
      { contentType: "image/gif", sizeBytes: 10 },
      { queue },
    );
    const zeroSize = await upload(
      userId,
      { contentType: "image/webp", sizeBytes: 0 },
      { queue },
    );
    const tooBig = await upload(
      userId,
      { contentType: "image/webp", sizeBytes: 5_000_001 },
      { queue },
    );

    expect(badType.status).toBe(400);
    expect(zeroSize.status).toBe(400);
    expect(tooBig.status).toBe(400);
  });
});

describe("users.me.profileImage.upload rate limits", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("answers 429 with Retry-After when the limiter denies", async () => {
    const userId = await seedUser();
    const { queue, sent } = fakeQueue();
    const denied: LimiterFactory = () => () =>
      Promise.resolve({ allowed: false, retryAfterSeconds: 30 });

    const response = await upload(
      userId,
      { contentType: "image/webp", sizeBytes: 10 },
      { queue, limiterFactory: denied },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(sent).toHaveLength(0);
    const rows = await db().select().from(storedFiles);
    expect(rows).toHaveLength(0);
  });
});

describe("users.me.profileImage.upload rate limit order", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("checks the per-IP policy after the per-user policy", async () => {
    const userId = await seedUser();
    const { queue } = fakeQueue();
    const limits: RateLimitRequest[] = [];
    const accessToken = await userAccessToken(userId, {
      now: TEST_TOKEN_INSTANT,
    });

    const response = await send(
      buildApp({ queue, limiterFactory: recordingLimiter(limits) }),
      "https://example.com/v1/me/profile-image/upload",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "CF-Connecting-IP": "203.0.113.11",
        },
        body: JSON.stringify({ contentType: "image/webp", sizeBytes: 10 }),
      },
      R2_ENV,
    );

    expect(response.status).toBe(200);
    expect(limits.map((line) => line.key)).toEqual([
      `users.profile-image.upload:user:${userId}`,
      "users.profile-image.upload:ip:203.0.113.11",
    ]);
    expect(limits[1]).toMatchObject({
      limit: 60,
      windowSeconds: 300,
      blockSeconds: 900,
    });
  });
});
