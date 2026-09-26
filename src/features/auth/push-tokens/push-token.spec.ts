import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authEnv,
  cleanAuthTables,
  fakeVerifier,
  jsonRecord,
  permissiveLimiterFactory,
  TEST_TOKEN_INSTANT,
  userAccessToken,
} from "../../../../test/auth-fixtures";
import { send } from "../../../../test/app-request";
import { fixedClock } from "../../../platform/clock/clock";
import { createDb } from "../../../platform/db/db";
import { sessions, users } from "../../../platform/db/schema";
import { createApp } from "../../../platform/http/app";
import type { PushPort } from "../../../platform/push/push";
import { registerAuthRoutes } from "../auth.routes";

const CLOCK = fixedClock(TEST_TOKEN_INSTANT);
const SEED_NOW = new Date(TEST_TOKEN_INSTANT.getTime() - 60_000);
const LIVE_UNTIL = new Date(TEST_TOKEN_INSTANT.getTime() + 86_400_000);
const TOKEN_TABLE = "tok-1";

function db() {
  return createDb(env.DB);
}

function pushEnabled(): PushPort {
  return { isEnabled: () => true };
}

function pushDisabled(): PushPort {
  return { isEnabled: () => false };
}

function buildApp(push: PushPort) {
  const app = createApp();

  registerAuthRoutes(app, {
    verifier: fakeVerifier(),
    clock: CLOCK,
    rateLimiterFactory: permissiveLimiterFactory(),
    push,
  });

  return app;
}

async function request(
  push: PushPort,
  input: Readonly<{
    method: "PUT" | "DELETE";
    sessionId: string;
    userId: string;
    body?: Record<string, unknown>;
  }>,
) {
  const accessToken = await userAccessToken(input.userId, {
    sessionId: input.sessionId,
    now: TEST_TOKEN_INSTANT,
  });

  return send(
    buildApp(push),
    "https://example.com/v1/me/push-token",
    {
      method: input.method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(input.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    },
    authEnv(),
  );
}

type SeedSessionOptions = Readonly<{
  revokedAt?: Date;
  expiresAt?: Date;
  pushPlatform?: "ANDROID" | "IOS" | "WEB";
  pushToken?: string;
  pushTokenRevokedAt?: Date;
  pushTokenUpdatedAt?: Date;
}>;

async function seedLiveSession(
  options: SeedSessionOptions = {},
): Promise<{ userId: string; sessionId: string }> {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  await db()
    .insert(users)
    .values({
      id: userId,
      email: `push-${userId}@example.com`,
      emailVerifiedAt: SEED_NOW,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });
  await db()
    .insert(sessions)
    .values({
      id: sessionId,
      userId,
      lastSeenAt: SEED_NOW,
      expiresAt: options.expiresAt ?? LIVE_UNTIL,
      revokedAt: options.revokedAt ?? null,
      pushPlatform: options.pushPlatform ?? null,
      pushToken: options.pushToken ?? null,
      pushTokenUpdatedAt: options.pushTokenUpdatedAt ?? null,
      pushTokenRevokedAt: options.pushTokenRevokedAt ?? null,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });

  return { userId, sessionId };
}

async function sessionRow(sessionId: string) {
  const rows = await db()
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  const [row] = rows;
  if (row === undefined) throw new Error("expected a session row");

  return row;
}

describe("users.me.pushToken.upsert gate", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("answers 501 and touches nothing when push is disabled", async () => {
    const { userId, sessionId } = await seedLiveSession();

    const response = await request(pushDisabled(), {
      method: "PUT",
      userId,
      sessionId,
      body: { platform: "ANDROID", token: TOKEN_TABLE },
    });

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_PUSH_NOT_CONFIGURED",
      status: 501,
    });
    const row = await sessionRow(sessionId);
    expect(row.pushToken).toBeNull();
    expect(row.pushTokenUpdatedAt).toBeNull();
  });
});

describe("users.me.pushToken.upsert", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("stores the trimmed platform and token on the caller session", async () => {
    const { userId, sessionId } = await seedLiveSession();

    const response = await request(pushEnabled(), {
      method: "PUT",
      userId,
      sessionId,
      body: { platform: " android ", token: ` ${TOKEN_TABLE} ` },
    });

    expect(response.status).toBe(204);
    const row = await sessionRow(sessionId);
    expect(row.pushPlatform).toBe("ANDROID");
    expect(row.pushToken).toBe(TOKEN_TABLE);
    expect(row.pushTokenUpdatedAt?.getTime()).toBe(
      TEST_TOKEN_INSTANT.getTime(),
    );
    expect(row.pushTokenRevokedAt).toBeNull();
  });

  it("transfers the token from another session", async () => {
    const holder = await seedLiveSession({
      pushPlatform: "IOS",
      pushToken: TOKEN_TABLE,
      pushTokenUpdatedAt: SEED_NOW,
    });
    const caller = await seedLiveSession();

    const response = await request(pushEnabled(), {
      method: "PUT",
      userId: caller.userId,
      sessionId: caller.sessionId,
      body: { platform: "ANDROID", token: TOKEN_TABLE },
    });

    expect(response.status).toBe(204);
    const previous = await sessionRow(holder.sessionId);
    expect(previous.pushPlatform).toBeNull();
    expect(previous.pushToken).toBeNull();
    expect(previous.pushTokenRevokedAt?.getTime()).toBe(
      TEST_TOKEN_INSTANT.getTime(),
    );
    const current = await sessionRow(caller.sessionId);
    expect(current.pushToken).toBe(TOKEN_TABLE);
    expect(current.pushTokenRevokedAt).toBeNull();
  });

  it("resets the revoked marker when the same session re-upserts", async () => {
    const { userId, sessionId } = await seedLiveSession({
      pushPlatform: "ANDROID",
      pushToken: TOKEN_TABLE,
      pushTokenRevokedAt: SEED_NOW,
      pushTokenUpdatedAt: SEED_NOW,
    });

    const response = await request(pushEnabled(), {
      method: "PUT",
      userId,
      sessionId,
      body: { platform: "ANDROID", token: TOKEN_TABLE },
    });

    expect(response.status).toBe(204);
    const row = await sessionRow(sessionId);
    expect(row.pushTokenRevokedAt).toBeNull();
    expect(row.pushTokenUpdatedAt?.getTime()).toBe(
      TEST_TOKEN_INSTANT.getTime(),
    );
  });
});

describe("users.me.pushToken.upsert session guards", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("rejects a revoked caller session without clearing another session", async () => {
    const holder = await seedLiveSession({
      pushPlatform: "ANDROID",
      pushToken: TOKEN_TABLE,
      pushTokenUpdatedAt: SEED_NOW,
    });
    const caller = await seedLiveSession({ revokedAt: SEED_NOW });

    const response = await request(pushEnabled(), {
      method: "PUT",
      userId: caller.userId,
      sessionId: caller.sessionId,
      body: { platform: "ANDROID", token: TOKEN_TABLE },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const previous = await sessionRow(holder.sessionId);
    expect(previous.pushToken).toBe(TOKEN_TABLE);
    expect(previous.pushTokenRevokedAt).toBeNull();
  });

  it("rejects an expired caller session", async () => {
    const caller = await seedLiveSession({
      expiresAt: new Date(TEST_TOKEN_INSTANT.getTime() - 1_000),
    });

    const response = await request(pushEnabled(), {
      method: "PUT",
      userId: caller.userId,
      sessionId: caller.sessionId,
      body: { platform: "ANDROID", token: TOKEN_TABLE },
    });

    expect(response.status).toBe(401);
  });

  it("validates platform, token length, and unknown fields", async () => {
    const { userId, sessionId } = await seedLiveSession();
    const push = pushEnabled();

    const badPlatform = await request(push, {
      method: "PUT",
      userId,
      sessionId,
      body: { platform: "DESKTOP", token: TOKEN_TABLE },
    });
    const emptyToken = await request(push, {
      method: "PUT",
      userId,
      sessionId,
      body: { platform: "ANDROID", token: "  " },
    });
    const longToken = await request(push, {
      method: "PUT",
      userId,
      sessionId,
      body: { platform: "ANDROID", token: "x".repeat(2049) },
    });
    const unknownField = await request(push, {
      method: "PUT",
      userId,
      sessionId,
      body: { platform: "ANDROID", token: TOKEN_TABLE, extra: true },
    });

    expect(badPlatform.status).toBe(400);
    expect(emptyToken.status).toBe(400);
    expect(longToken.status).toBe(400);
    await expect(unknownField.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    const body = await jsonRecord(longToken);
    expect(body.code).toBe("VALIDATION_FAILED");
  });
});

describe("users.me.pushToken.revoke", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("clears the caller session and is idempotent", async () => {
    const { userId, sessionId } = await seedLiveSession({
      pushPlatform: "WEB",
      pushToken: TOKEN_TABLE,
      pushTokenUpdatedAt: SEED_NOW,
    });

    const first = await request(pushDisabled(), {
      method: "DELETE",
      userId,
      sessionId,
    });
    const second = await request(pushDisabled(), {
      method: "DELETE",
      userId,
      sessionId,
    });

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    const row = await sessionRow(sessionId);
    expect(row.pushToken).toBeNull();
    expect(row.pushPlatform).toBeNull();
    expect(row.pushTokenRevokedAt?.getTime()).toBe(
      TEST_TOKEN_INSTANT.getTime(),
    );
  });

  it("leaves another session's token untouched", async () => {
    const holder = await seedLiveSession({
      pushPlatform: "IOS",
      pushToken: TOKEN_TABLE,
    });
    const caller = await seedLiveSession();

    const response = await request(pushEnabled(), {
      method: "DELETE",
      userId: caller.userId,
      sessionId: caller.sessionId,
    });

    expect(response.status).toBe(204);
    const previous = await sessionRow(holder.sessionId);
    expect(previous.pushToken).toBe(TOKEN_TABLE);
    expect(previous.pushTokenRevokedAt).toBeNull();
  });
});
