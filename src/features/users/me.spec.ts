import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authEnv,
  cleanAuthTables,
  jsonRecord,
  pick,
  pickString,
  userAccessToken,
} from "../../../test/auth-fixtures";
import { send } from "../../../test/app-request";
import { createDb } from "../../platform/db/db";
import { oidcIdentities, users } from "../../platform/db/schema";
import { createApp } from "../../platform/http/app";
import { registerUsersRoutes } from "./users.routes";

function db() {
  return createDb(env.DB);
}

function buildApp() {
  const app = createApp();

  registerUsersRoutes(app);

  return app;
}

async function seedUser(
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();

  await db()
    .insert(users)
    .values({
      id,
      email: `me-${id}@example.com`,
      emailVerifiedAt: now,
      displayName: "Dante",
      givenName: "Given",
      familyName: "Family",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });

  return id;
}

async function seedGoogleIdentity(userId: string): Promise<void> {
  const now = new Date();

  await db()
    .insert(oidcIdentities)
    .values({
      id: crypto.randomUUID(),
      userId,
      provider: "GOOGLE",
      subject: `subject-${crypto.randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    });
}

function getMe(token?: string): Response | Promise<Response> {
  return send(
    buildApp(),
    "https://example.com/v1/me",
    token === undefined
      ? undefined
      : { headers: { Authorization: `Bearer ${token}` } },
    authEnv(),
  );
}

function patchMe(
  token: string | undefined,
  body: unknown,
  idempotencyKey?: string,
): Response | Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey !== undefined) headers["Idempotency-Key"] = idempotencyKey;

  return send(
    buildApp(),
    "https://example.com/v1/me",
    { method: "PATCH", headers, body: JSON.stringify(body) },
    authEnv(),
  );
}

function firstErrorField(body: Record<string, unknown>): unknown {
  const errors = body.errors;
  if (!Array.isArray(errors) || errors.length === 0) return undefined;

  const first: unknown = errors[0];
  if (typeof first !== "object" || first === null) return undefined;

  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(first)) record[key] = value;

  return record.field;
}

describe("users.me.get", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("returns the fresh projection with the envelope", async () => {
    const userId = await seedUser();
    await seedGoogleIdentity(userId);

    const response = await getMe(await userAccessToken(userId));

    expect(response.status).toBe(200);
    const body = await jsonRecord(response);

    expect(pick(body, "data")).toEqual({
      id: userId,
      email: `me-${userId}@example.com`,
      emailVerified: true,
      roles: ["USER"],
      authMethods: ["GOOGLE"],
      profile: {
        profileImageFileId: null,
        displayName: "Dante",
        givenName: "Given",
        familyName: "Family",
      },
      accountDeletion: null,
    });
  });

  it("requires a valid bearer token", async () => {
    const missing = await getMe();
    expect(missing.status).toBe(401);

    const invalid = await getMe("garbage");
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects deleted users", async () => {
    const userId = await seedUser({ status: "DELETED" });

    const response = await getMe(await userAccessToken(userId));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("users.me.patch: updates", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("sets trimmed values and returns the fresh projection", async () => {
    const userId = await seedUser();

    const response = await patchMe(await userAccessToken(userId), {
      profile: { displayName: "  Beatrice  " },
    });

    expect(response.status).toBe(200);
    const body = await jsonRecord(response);
    const profile = pick(body, "data", "profile");

    expect(profile).toMatchObject({
      displayName: "Beatrice",
      givenName: "Given",
      familyName: "Family",
    });

    const rows = await db().select().from(users).where(eq(users.id, userId));
    expect(rows[0]?.displayName).toBe("Beatrice");
    expect(rows[0]?.givenName).toBe("Given");
  });

  it("clears fields with null", async () => {
    const userId = await seedUser();

    const response = await patchMe(await userAccessToken(userId), {
      profile: { givenName: null },
    });

    expect(response.status).toBe(200);
    const body = await jsonRecord(response);

    expect(pick(body, "data", "profile")).toMatchObject({
      displayName: "Dante",
      givenName: null,
    });
  });

  it("rejects deleted users", async () => {
    const userId = await seedUser({ status: "DELETED" });

    const response = await patchMe(await userAccessToken(userId), {
      profile: { displayName: "Beatrice" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("users.me.patch: validation", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("rejects an empty profile", async () => {
    const userId = await seedUser();

    const response = await patchMe(await userAccessToken(userId), {
      profile: {},
    });

    expect(response.status).toBe(400);
    const body = await jsonRecord(response);

    expect(body).toMatchObject({
      code: "VALIDATION_FAILED",
      title: "Validation Failed",
    });
    expect(firstErrorField(body)).toBe("profile");
  });

  it("rejects whitespace-only and over-length values", async () => {
    const userId = await seedUser();
    const token = await userAccessToken(userId);

    const blank = await patchMe(token, { profile: { displayName: "   " } });
    const blankBody = await jsonRecord(blank);
    expect(blank.status).toBe(400);
    expect(firstErrorField(blankBody)).toBe("profile.displayName");

    const long = await patchMe(token, {
      profile: { displayName: "x".repeat(101) },
    });
    const longBody = await jsonRecord(long);
    expect(long.status).toBe(400);
    expect(firstErrorField(longBody)).toBe("profile.displayName");
  });

  it("rejects unknown fields at both levels", async () => {
    const userId = await seedUser();
    const token = await userAccessToken(userId);

    const nested = await patchMe(token, {
      profile: { displayName: "Beatrice", nickname: "Bea" },
    });
    const nestedBody = await jsonRecord(nested);
    expect(nested.status).toBe(400);
    expect(firstErrorField(nestedBody)).toBe("profile.nickname");

    const topLevel = await patchMe(token, {
      extra: true,
      profile: { displayName: "Beatrice" },
    });
    const topLevelBody = await jsonRecord(topLevel);
    expect(topLevel.status).toBe(400);
    expect(firstErrorField(topLevelBody)).toBe("extra");
  });

  it("requires the profile key", async () => {
    const userId = await seedUser();

    const response = await patchMe(await userAccessToken(userId), {});

    expect(response.status).toBe(400);
    const body = await jsonRecord(response);
    expect(firstErrorField(body)).toBe("profile");
  });
});

describe("users.me.patch: idempotency", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("replays with the same key and payload", async () => {
    const userId = await seedUser();
    const token = await userAccessToken(userId);
    const key = `patch-${crypto.randomUUID()}`;
    const body = { profile: { displayName: "Replay" } };

    const first = await patchMe(token, body, key);
    const second = await patchMe(token, body, key);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(
      pickString(await jsonRecord(second), "data", "profile", "displayName"),
    ).toBe("Replay");
  });

  it("conflicts when the key is reused with a different payload", async () => {
    const userId = await seedUser();
    const token = await userAccessToken(userId);
    const key = `patch-${crypto.randomUUID()}`;

    await patchMe(token, { profile: { displayName: "First" } }, key);
    const conflict = await patchMe(
      token,
      { profile: { displayName: "Second" } },
      key,
    );

    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "CONFLICT",
    });
  });
});
