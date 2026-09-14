import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authEnv,
  cleanAuthTables,
  jsonRecord,
  pick,
  recordsOf,
  userAccessToken,
} from "../../../test/auth-fixtures";
import { send } from "../../../test/app-request";
import { sha256Base64Url, randomBase64Url } from "../../platform/crypto/crypto";
import { createDb } from "../../platform/db/db";
import { refreshTokens, sessions, users } from "../../platform/db/schema";
import { createApp } from "../../platform/http/app";
import { registerUsersRoutes } from "./users.routes";

const T0 = new Date("2026-06-01T00:00:00.000Z");

function db() {
  return createDb(env.DB);
}

function buildApp() {
  const app = createApp();

  registerUsersRoutes(app);

  return app;
}

async function seedUser(): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();

  await db()
    .insert(users)
    .values({
      id,
      email: `sessions-${id}@example.com`,
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });

  return id;
}

type SeededSession = Readonly<{ id: string; refreshToken: string }>;

async function seedSession(
  userId: string,
  options: Readonly<{
    createdAt?: Date;
    expiresAt?: Date;
    revokedAt?: Date;
    deviceId?: string;
    deviceName?: string;
  }> = {},
): Promise<SeededSession> {
  const id = crypto.randomUUID();
  const refreshToken = randomBase64Url(32);
  const createdAt = options.createdAt ?? T0;

  await db()
    .insert(sessions)
    .values({
      id,
      userId,
      deviceId: options.deviceId ?? null,
      deviceName: options.deviceName ?? null,
      lastSeenAt: createdAt,
      expiresAt: options.expiresAt ?? new Date("2027-06-01T00:00:00.000Z"),
      revokedAt: options.revokedAt ?? null,
      createdAt,
      updatedAt: createdAt,
    });
  await db()
    .insert(refreshTokens)
    .values({
      id: crypto.randomUUID(),
      sessionId: id,
      tokenHash: await sha256Base64Url(refreshToken),
      expiresAt: options.expiresAt ?? new Date("2027-06-01T00:00:00.000Z"),
      createdAt,
      updatedAt: createdAt,
    });

  return { id, refreshToken };
}

function listSessions(
  token?: string,
  query = "",
): Response | Promise<Response> {
  return send(
    buildApp(),
    `https://example.com/v1/me/sessions${query}`,
    token === undefined
      ? undefined
      : { headers: { Authorization: `Bearer ${token}` } },
    authEnv(),
  );
}

function revokeSession(
  token: string | undefined,
  sessionId: string,
): Response | Promise<Response> {
  return send(
    buildApp(),
    `https://example.com/v1/me/sessions/${sessionId}/revoke`,
    {
      method: "POST",
      headers:
        token === undefined ? undefined : { Authorization: `Bearer ${token}` },
    },
    authEnv(),
  );
}

function sessionIds(body: Record<string, unknown>): string[] {
  return recordsOf(body).flatMap((session) =>
    typeof session.id === "string" ? [session.id] : [],
  );
}

function sessionById(
  body: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  const found = recordsOf(body).find((session) => session.id === id);
  if (found === undefined) {
    throw new Error(`session ${id} not found in response`);
  }

  return found;
}

describe("users.me.sessions.list: statuses and shape", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("lists sessions with statuses and the current flag", async () => {
    const userId = await seedUser();
    const active = await seedSession(userId, {
      deviceId: "device-a",
      deviceName: "iPhone 15",
      createdAt: T0,
    });
    await seedSession(userId, {
      createdAt: new Date(T0.getTime() + 1_000),
      expiresAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    await seedSession(userId, {
      createdAt: new Date(T0.getTime() + 2_000),
      revokedAt: new Date(T0.getTime() + 3_000),
    });

    const response = await listSessions(
      await userAccessToken(userId, { sessionId: active.id }),
    );

    expect(response.status).toBe(200);
    const body = await jsonRecord(response);

    expect(sessionIds(body)).toHaveLength(3);

    const current = sessionById(body, active.id);
    expect(current).toMatchObject({
      status: "active",
      current: true,
      deviceId: "device-a",
      deviceName: "iPhone 15",
      ip: null,
      userAgent: null,
      revokedAt: null,
    });

    const statuses = sessionIds(body).map((id) => sessionById(body, id).status);
    expect(statuses).toEqual(["revoked", "expired", "active"]);

    expect(pick(body, "meta")).toEqual({ limit: 25, hasMore: false });
  });

  it("lets revoked win over expired", async () => {
    const userId = await seedUser();
    const both = await seedSession(userId, {
      revokedAt: T0,
      expiresAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    const response = await listSessions(await userAccessToken(userId));
    const body = await jsonRecord(response);

    expect(sessionById(body, both.id).status).toBe("revoked");
  });

  it("excludes other users' sessions and requires a token", async () => {
    const mine = await seedUser();
    const theirs = await seedUser();
    const mySession = await seedSession(mine);
    await seedSession(theirs);

    const response = await listSessions(await userAccessToken(mine));
    const body = await jsonRecord(response);
    expect(sessionIds(body)).toEqual([mySession.id]);

    const unauthorized = await listSessions();
    expect(unauthorized.status).toBe(401);
  });
});

describe("users.me.sessions.list: pagination", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("round-trips the cursor across pages", async () => {
    const userId = await seedUser();
    const seeded: string[] = [];

    for (let index = 0; index < 5; index += 1) {
      const session = await seedSession(userId, {
        createdAt: new Date(T0.getTime() + index * 1_000),
      });
      seeded.push(session.id);
    }

    const token = await userAccessToken(userId);
    const first = await jsonRecord(await listSessions(token, "?limit=2"));
    expect(sessionIds(first)).toEqual([seeded[4], seeded[3]]);
    expect(pick(first, "meta")).toMatchObject({
      limit: 2,
      hasMore: true,
    });

    const firstCursor = pick(first, "meta", "nextCursor");
    expect(typeof firstCursor).toBe("string");

    const second = await jsonRecord(
      await listSessions(token, `?limit=2&cursor=${String(firstCursor)}`),
    );
    expect(sessionIds(second)).toEqual([seeded[2], seeded[1]]);

    const secondCursor = pick(second, "meta", "nextCursor");
    const third = await jsonRecord(
      await listSessions(token, `?limit=2&cursor=${String(secondCursor)}`),
    );
    expect(sessionIds(third)).toEqual([seeded[0]]);
    expect(pick(third, "meta")).toEqual({ limit: 2, hasMore: false });
  });

  it("supports the id sort and rejects invalid queries", async () => {
    const userId = await seedUser();
    const session = await seedSession(userId);
    const token = await userAccessToken(userId);

    const sorted = await jsonRecord(await listSessions(token, "?sort=-id"));
    expect(sessionIds(sorted)).toEqual([session.id]);

    for (const query of [
      "?limit=101",
      "?limit=0",
      "?sort=email",
      "?cursor=garbage",
      "?foo=1",
    ]) {
      const response = await listSessions(token, query);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    }
  });
});

describe("users.me.sessions.revoke: semantics", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("revokes the session and its refresh tokens", async () => {
    const userId = await seedUser();
    const session = await seedSession(userId);

    const response = await revokeSession(
      await userAccessToken(userId),
      session.id,
    );
    expect(response.status).toBe(204);

    const sessionRows = await db()
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(sessionRows[0]?.revokedAt).toBeInstanceOf(Date);

    const tokenRows = await db()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.sessionId, session.id));
    expect(tokenRows).toHaveLength(1);
    expect(tokenRows[0]?.revokedAt).toBeInstanceOf(Date);
  });

  it("is idempotent and allows revoking the current session", async () => {
    const userId = await seedUser();
    const session = await seedSession(userId);
    const token = await userAccessToken(userId, { sessionId: session.id });

    const first = await revokeSession(token, session.id);
    const second = await revokeSession(token, session.id);

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);

    const me = await send(
      buildApp(),
      "https://example.com/v1/me",
      { headers: { Authorization: `Bearer ${token}` } },
      authEnv(),
    );
    expect(me.status).toBe(200);
  });
});

describe("users.me.sessions.revoke: validation", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("returns 404 for unknown and foreign sessions", async () => {
    const mine = await seedUser();
    const theirs = await seedUser();
    const foreign = await seedSession(theirs);
    const token = await userAccessToken(mine);

    const unknown = await revokeSession(token, crypto.randomUUID());
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      title: "Not Found",
    });

    const foreignAttempt = await revokeSession(token, foreign.id);
    expect(foreignAttempt.status).toBe(404);
  });

  it("rejects non-UUID ids and missing tokens", async () => {
    const userId = await seedUser();
    const token = await userAccessToken(userId);

    const invalid = await revokeSession(token, "not-a-uuid");
    expect(invalid.status).toBe(400);
    const body = await jsonRecord(invalid);

    expect(body).toMatchObject({ code: "VALIDATION_FAILED" });

    const noToken = await revokeSession(undefined, crypto.randomUUID());
    expect(noToken.status).toBe(401);
  });
});
