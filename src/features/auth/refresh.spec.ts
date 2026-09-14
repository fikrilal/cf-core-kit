import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authEnv,
  cleanAuthTables,
  fakeVerifier,
  jsonRecord,
  permissiveLimiterFactory,
  pick,
  pickString,
  seedSessionWithRefreshToken,
  TEST_SIGNING_KEYS_JSON,
  TEST_TOKEN_INSTANT,
  type SeededSession,
} from "../../../test/auth-fixtures";
import { send } from "../../../test/app-request";
import { verifyAccessToken } from "../../platform/auth/access-token";
import { buildKeyRing } from "../../platform/auth/keys";
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

function refreshRequest(refreshToken: string): Response | Promise<Response> {
  const app = createApp();

  registerAuthRoutes(app, {
    verifier: fakeVerifier(),
    clock: CLOCK,
    rateLimiterFactory: permissiveLimiterFactory(),
  });

  return send(
    app,
    "https://example.com/v1/auth/refresh",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    },
    authEnv(),
  );
}

async function testKeyRing() {
  return buildKeyRing({
    authSigningKeysJson: TEST_SIGNING_KEYS_JSON,
    authSigningKeysJsonBase64: undefined,
  });
}

async function sessionRow(sessionId: string) {
  const rows = await db()
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId));

  return rows[0];
}

describe("refresh: rotation", () => {
  let seeded: SeededSession;
  let before: typeof sessions.$inferSelect | undefined;
  let body: Record<string, unknown> = {};

  beforeEach(async () => {
    await cleanAuthTables(db());

    seeded = await seedSessionWithRefreshToken(db(), {
      now: SEED_NOW,
      email: "rotate@example.com",
    });
    before = await sessionRow(seeded.sessionId);

    const response = await refreshRequest(seeded.refreshToken);

    expect(response.status).toBe(200);
    body = await jsonRecord(response);
  });

  it("returns the user payload and a verifiable access token", async () => {
    expect(pick(body, "data", "user")).toEqual({
      id: seeded.userId,
      email: "rotate@example.com",
      emailVerified: true,
    });

    const nextToken = pickString(body, "data", "refreshToken");
    expect(nextToken).not.toBe(seeded.refreshToken);

    const principal = await verifyAccessToken({
      token: pickString(body, "data", "accessToken"),
      keyRing: await testKeyRing(),
      now: TEST_TOKEN_INSTANT,
    });
    expect(principal?.sessionId).toBe(seeded.sessionId);
    expect(principal?.userId).toBe(seeded.userId);
  });

  it("links the replacement token and preserves the session expiry", async () => {
    const oldRows = await db()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, seeded.tokenId));
    const oldToken = oldRows[0];
    if (oldToken === undefined) throw new Error("expected the old token row");

    expect(oldToken.revokedAt).toBeInstanceOf(Date);

    const replacementId = oldToken.replacedById;
    if (replacementId === null) throw new Error("expected a replacement id");

    const nextRows = await db()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, replacementId));
    const nextToken = nextRows[0];
    if (nextToken === undefined)
      throw new Error("expected the replacement row");

    expect(nextToken.sessionId).toBe(seeded.sessionId);
    expect(nextToken.expiresAt.getTime()).toBe(oldToken.expiresAt.getTime());
    expect(nextToken.revokedAt).toBeNull();

    const after = await sessionRow(seeded.sessionId);
    if (after === undefined || before === undefined) {
      throw new Error("expected session rows");
    }

    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
    expect(after.lastSeenAt.getTime()).toBeGreaterThan(
      before.lastSeenAt.getTime(),
    );
  });
});

describe("refresh: reuse detection", () => {
  let seeded: SeededSession;
  let rotatedToken = "";

  beforeEach(async () => {
    await cleanAuthTables(db());

    seeded = await seedSessionWithRefreshToken(db(), { now: SEED_NOW });

    const rotated = await refreshRequest(seeded.refreshToken);
    rotatedToken = pickString(
      await jsonRecord(rotated),
      "data",
      "refreshToken",
    );
  });

  it("treats a rotated token as reuse and revokes the whole session", async () => {
    const reuse = await refreshRequest(seeded.refreshToken);

    expect(reuse.status).toBe(401);
    await expect(reuse.json()).resolves.toMatchObject({
      code: "AUTH_REFRESH_TOKEN_REUSED",
    });

    const session = await sessionRow(seeded.sessionId);
    if (session === undefined) throw new Error("expected the session row");

    expect(session.revokedAt).toBeInstanceOf(Date);

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

    const afterRevoke = await refreshRequest(rotatedToken);
    expect(afterRevoke.status).toBe(401);
    await expect(afterRevoke.json()).resolves.toMatchObject({
      code: "AUTH_SESSION_REVOKED",
    });
  });
});

describe("refresh: failure order", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("rejects unknown tokens", async () => {
    const response = await refreshRequest("unknown-token-value");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_REFRESH_TOKEN_INVALID",
    });
  });

  it("rejects expired tokens and expired sessions", async () => {
    const expiredToken = await seedSessionWithRefreshToken(db(), {
      now: SEED_NOW,
      tokenExpiresAt: new Date(SEED_NOW.getTime() + 1_000),
    });
    const expiredSession = await seedSessionWithRefreshToken(db(), {
      now: SEED_NOW,
      sessionExpiresAt: new Date(SEED_NOW.getTime() + 1_000),
    });

    for (const seeded of [expiredToken, expiredSession]) {
      const response = await refreshRequest(seeded.refreshToken);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        code: "AUTH_REFRESH_TOKEN_EXPIRED",
      });
    }
  });

  it("rejects revoked sessions before inspecting the token", async () => {
    const seeded = await seedSessionWithRefreshToken(db(), {
      now: SEED_NOW,
      sessionRevokedAt: SEED_NOW,
      tokenRevokedAt: SEED_NOW,
    });

    const response = await refreshRequest(seeded.refreshToken);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_SESSION_REVOKED",
    });
  });

  it("rejects suspended and deleted users", async () => {
    const suspended = await seedSessionWithRefreshToken(db(), {
      now: SEED_NOW,
      status: "SUSPENDED",
    });
    const deleted = await seedSessionWithRefreshToken(db(), {
      now: SEED_NOW,
      status: "DELETED",
    });

    const suspendedResponse = await refreshRequest(suspended.refreshToken);
    expect(suspendedResponse.status).toBe(403);
    await expect(suspendedResponse.json()).resolves.toMatchObject({
      code: "AUTH_USER_SUSPENDED",
    });

    const deletedResponse = await refreshRequest(deleted.refreshToken);
    expect(deletedResponse.status).toBe(401);
    await expect(deletedResponse.json()).resolves.toMatchObject({
      code: "AUTH_REFRESH_TOKEN_INVALID",
    });
  });
});

describe("refresh: single use under concurrency", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("lets exactly one rotation win and revokes the session", async () => {
    const seeded = await seedSessionWithRefreshToken(db(), { now: SEED_NOW });

    const [first, second] = await Promise.all([
      refreshRequest(seeded.refreshToken),
      refreshRequest(seeded.refreshToken),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);

    expect(statuses).toEqual([200, 401]);

    const failed = first.status === 401 ? first : second;
    const failure = await jsonRecord(failed);

    expect(["AUTH_REFRESH_TOKEN_REUSED", "AUTH_SESSION_REVOKED"]).toContain(
      pick(failure, "code"),
    );

    const session = await sessionRow(seeded.sessionId);
    if (session === undefined) throw new Error("expected the session row");
    expect(session.revokedAt).toBeInstanceOf(Date);
  });
});
