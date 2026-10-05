import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoContent } from "../support/assertions";

import {
  authEnv,
  cleanAuthTables,
  fakeVerifier,
  permissiveLimiterFactory,
  TEST_TOKEN_INSTANT,
  userAccessToken,
} from "../auth-fixtures";
import { send } from "../app-request";
import { captureConsoleLogs } from "../queue-fixtures";
import { registerAuthRoutes } from "../../src/features/auth/auth.routes";
import { registerUsersRoutes } from "../../src/features/users/users.routes";
import { fixedClock } from "../../src/platform/clock/clock";
import { sha256Base64Url } from "../../src/platform/crypto/crypto";
import { createDb } from "../../src/platform/db/db";
import { emailVerificationTokens, users } from "../../src/platform/db/schema";
import { createApp } from "../../src/platform/http/app";

function db() {
  return createDb(env.DB);
}

function buildApp() {
  const app = createApp();

  registerAuthRoutes(app, {
    verifier: fakeVerifier(),
    clock: fixedClock(TEST_TOKEN_INSTANT),
    rateLimiterFactory: permissiveLimiterFactory(),
  });
  registerUsersRoutes(app);

  return app;
}

describe("email verification across features", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("a pre-verification access token sees emailVerified on /v1/me after verify", async () => {
    const userId = crypto.randomUUID();
    const rawToken = "integration-verify-token";
    const now = new Date(TEST_TOKEN_INSTANT.getTime() - 60_000);

    await db()
      .insert(users)
      .values({
        id: userId,
        email: `verify-${userId}@example.com`,
        emailVerifiedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    await db()
      .insert(emailVerificationTokens)
      .values({
        id: crypto.randomUUID(),
        userId,
        tokenHash: await sha256Base64Url(rawToken),
        expiresAt: new Date(TEST_TOKEN_INSTANT.getTime() + 3600_000),
        usedAt: null,
        revokedAt: null,
        createdAt: now,
        updatedAt: now,
      });

    const app = buildApp();
    const accessToken = await userAccessToken(userId, { emailVerified: false });

    const before = await send(
      app,
      "https://example.com/v1/me",
      { headers: { authorization: `Bearer ${accessToken}` } },
      authEnv(),
    );
    expect(before.status).toBe(200);
    await expect(before.json()).resolves.toMatchObject({
      data: { emailVerified: false },
    });

    const verify = await send(
      app,
      "https://example.com/v1/auth/email/verify",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: rawToken }),
      },
      authEnv(),
    );
    await expectNoContent(verify);

    const after = await send(
      app,
      "https://example.com/v1/me",
      { headers: { authorization: `Bearer ${accessToken}` } },
      authEnv(),
    );
    await expect(after.json()).resolves.toMatchObject({
      data: { emailVerified: true },
    });
  });
});

describe("resend job delivery across features", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("delivers an enqueued resend job through the real queue", async () => {
    const userId = crypto.randomUUID();
    const now = new Date(TEST_TOKEN_INSTANT.getTime() - 60_000);

    await db()
      .insert(users)
      .values({
        id: userId,
        email: `deliver-${userId}@example.com`,
        emailVerifiedAt: null,
        createdAt: now,
        updatedAt: now,
      });

    const accessToken = await userAccessToken(userId, {
      emailVerified: false,
      now: TEST_TOKEN_INSTANT,
    });
    const { records, restore } = captureConsoleLogs();

    try {
      const response = await send(
        buildApp(),
        "https://example.com/v1/auth/email/verification/resend",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "CF-Connecting-IP": "203.0.113.7",
          },
        },
        authEnv({
          RESEND_API_KEY: "re_test_key",
          EMAIL_FROM: "no-reply@example.com",
        }),
      );

      await expectNoContent(response);

      await vi.waitFor(
        () => {
          const skip = records.find(
            (record) =>
              record.message === "verification email skipped" &&
              record.userId === userId,
          );
          expect(skip?.reason).toBe("email_not_configured");
        },
        { timeout: 15_000, interval: 100 },
      );
    } finally {
      restore();
    }
  });
});
