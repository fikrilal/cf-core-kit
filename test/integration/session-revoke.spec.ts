import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authEnv,
  cleanAuthTables,
  fakeVerifier,
  permissiveLimiterFactory,
  userAccessToken,
} from "../auth-fixtures";
import { send } from "../app-request";
import { registerAuthRoutes } from "../../src/features/auth/auth.routes";
import { registerUsersRoutes } from "../../src/features/users/users.routes";
import {
  randomBase64Url,
  sha256Base64Url,
} from "../../src/platform/crypto/crypto";
import { createDb } from "../../src/platform/db/db";
import { refreshTokens, sessions, users } from "../../src/platform/db/schema";
import { createApp } from "../../src/platform/http/app";

function db() {
  return createDb(env.DB);
}

function buildApp() {
  const app = createApp();

  registerAuthRoutes(app, {
    verifier: fakeVerifier(),
    rateLimiterFactory: permissiveLimiterFactory(),
  });
  registerUsersRoutes(app);

  return app;
}

describe("session revocation across features", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("users revoke makes auth refresh fail with SESSION_REVOKED", async () => {
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const refreshToken = randomBase64Url(32);
    const now = new Date();

    await db()
      .insert(users)
      .values({
        id: userId,
        email: `revoke-${userId}@example.com`,
        emailVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    await db()
      .insert(sessions)
      .values({
        id: sessionId,
        userId,
        lastSeenAt: now,
        expiresAt: new Date("2027-06-01T00:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
      });
    await db()
      .insert(refreshTokens)
      .values({
        id: crypto.randomUUID(),
        sessionId,
        tokenHash: await sha256Base64Url(refreshToken),
        expiresAt: new Date("2027-06-01T00:00:00.000Z"),
        createdAt: now,
        updatedAt: now,
      });

    const app = buildApp();
    const revoke = await send(
      app,
      `https://example.com/v1/me/sessions/${sessionId}/revoke`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await userAccessToken(userId)}`,
        },
      },
      authEnv(),
    );

    expect(revoke.status).toBe(204);

    const refresh = await send(
      app,
      "https://example.com/v1/auth/refresh",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      },
      authEnv(),
    );

    expect(refresh.status).toBe(401);
    await expect(refresh.json()).resolves.toMatchObject({
      code: "AUTH_SESSION_REVOKED",
    });
  });
});
