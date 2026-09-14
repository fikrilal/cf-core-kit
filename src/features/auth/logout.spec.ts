import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authEnv,
  cleanAuthTables,
  fakeVerifier,
  seedSessionWithRefreshToken,
  TEST_TOKEN_INSTANT,
} from "../../../test/auth-fixtures";
import { send } from "../../../test/app-request";
import { fixedClock } from "../../platform/clock/clock";
import { createDb } from "../../platform/db/db";
import { refreshTokens, sessions } from "../../platform/db/schema";
import { createApp } from "../../platform/http/app";
import { registerAuthRoutes } from "./auth.routes";

const CLOCK = fixedClock(TEST_TOKEN_INSTANT);
const SEED_NOW = new Date(TEST_TOKEN_INSTANT.getTime() - 60_000);

function db() {
  return createDb(env.DB);
}

function request(
  path: string,
  body: Record<string, unknown>,
): Response | Promise<Response> {
  const app = createApp();

  registerAuthRoutes(app, { verifier: fakeVerifier(), clock: CLOCK });

  return send(
    app,
    `https://example.com${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    authEnv(),
  );
}

function logoutRequest(refreshToken: string): Response | Promise<Response> {
  return request("/v1/auth/logout", { refreshToken });
}

describe("logout", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("revokes the session, its tokens, and blocks further refresh", async () => {
    const seeded = await seedSessionWithRefreshToken(db(), { now: SEED_NOW });

    const response = await logoutRequest(seeded.refreshToken);

    expect(response.status).toBe(204);

    const sessionRows = await db()
      .select()
      .from(sessions)
      .where(eq(sessions.id, seeded.sessionId));
    expect(sessionRows[0]?.revokedAt).toBeInstanceOf(Date);
    expect(sessionRows[0]?.activeKey).toBeNull();

    const activeTokens = await db()
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.sessionId, seeded.sessionId),
          isNull(refreshTokens.revokedAt),
        ),
      );
    expect(activeTokens).toHaveLength(0);

    const refresh = await request("/v1/auth/refresh", {
      refreshToken: seeded.refreshToken,
    });
    expect(refresh.status).toBe(401);
    await expect(refresh.json()).resolves.toMatchObject({
      code: "AUTH_SESSION_REVOKED",
    });
  });

  it("is idempotent for the same token", async () => {
    const seeded = await seedSessionWithRefreshToken(db(), { now: SEED_NOW });

    const first = await logoutRequest(seeded.refreshToken);
    const second = await logoutRequest(seeded.refreshToken);

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
  });

  it("rejects unknown tokens", async () => {
    const response = await logoutRequest("unknown-token-value");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_REFRESH_TOKEN_INVALID",
    });
  });

  it("validates the payload with the dialect problem shape", async () => {
    const response = await request("/v1/auth/logout", {});

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      title: "Validation Failed",
    });
  });
});
