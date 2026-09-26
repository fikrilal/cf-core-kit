import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authEnv,
  cleanAuthTables,
  jsonRecord,
  TEST_TOKEN_INSTANT,
  userAccessToken,
} from "../../../../test/auth-fixtures";
import { send } from "../../../../test/app-request";
import { fixedClock } from "../../../platform/clock/clock";
import { createDb } from "../../../platform/db/db";
import { userAccountDeletionAudits, users } from "../../../platform/db/schema";
import { createApp } from "../../../platform/http/app";
import { registerUsersRoutes } from "../users.routes";

const CLOCK = fixedClock(TEST_TOKEN_INSTANT);
const SEED_NOW = new Date(TEST_TOKEN_INSTANT.getTime() - 60_000);
const SCHEDULED_FOR = new Date(
  TEST_TOKEN_INSTANT.getTime() + 30 * 24 * 60 * 60 * 1000,
);

const REQUEST_PATH = "/v1/me/account-deletion/request";
const CANCEL_PATH = "/v1/me/account-deletion/cancel";

function db() {
  return createDb(env.DB);
}

function buildApp() {
  const app = createApp();

  registerUsersRoutes(app, { clock: CLOCK });

  return app;
}

async function seedUser(
  overrides: Partial<typeof users.$inferInsert> = {},
): Promise<string> {
  const id = crypto.randomUUID();

  await db()
    .insert(users)
    .values({
      id,
      email: `deletion-${id}@example.com`,
      emailVerifiedAt: SEED_NOW,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
      ...overrides,
    });

  return id;
}

async function post(
  path: string,
  userId: string,
  options: Readonly<{ idempotencyKey?: string }> = {},
): Promise<Response> {
  const accessToken = await userAccessToken(userId, {
    now: TEST_TOKEN_INSTANT,
  });

  return send(
    buildApp(),
    `https://example.com${path}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(options.idempotencyKey === undefined
          ? {}
          : { "idempotency-key": options.idempotencyKey }),
      },
    },
    authEnv(),
  );
}

async function me(userId: string): Promise<Record<string, unknown>> {
  const accessToken = await userAccessToken(userId, {
    now: TEST_TOKEN_INSTANT,
  });
  const response = await send(
    buildApp(),
    "https://example.com/v1/me",
    { headers: { authorization: `Bearer ${accessToken}` } },
    authEnv(),
  );
  const body = await jsonRecord(response);
  const data = body.data;

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error("expected a data object");
  }

  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) record[key] = value;

  return record;
}

async function userRow(userId: string) {
  const rows = await db().select().from(users).where(eq(users.id, userId));
  const [row] = rows;
  if (row === undefined) throw new Error("expected a user row");

  return row;
}

async function audits() {
  return db().select().from(userAccountDeletionAudits);
}

describe("users.me.accountDeletion.request", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("schedules deletion, writes the audit, and surfaces it on /v1/me", async () => {
    const userId = await seedUser();

    const response = await post(REQUEST_PATH, userId);

    expect(response.status).toBe(204);
    const row = await userRow(userId);
    expect(row.deletionRequestedAt?.getTime()).toBe(
      TEST_TOKEN_INSTANT.getTime(),
    );
    expect(row.deletionScheduledFor?.getTime()).toBe(SCHEDULED_FOR.getTime());
    expect(row.deletionRequestedSessionId).not.toBeNull();
    expect(row.deletionRequestedTraceId).not.toBeNull();
    expect(row.status).toBe("ACTIVE");

    const recorded = await audits();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      actorUserId: userId,
      targetUserId: userId,
      action: "REQUESTED",
    });
    expect(recorded[0]?.traceId).not.toBeNull();

    const body = await me(userId);
    expect(body.accountDeletion).toEqual({
      requestedAt: TEST_TOKEN_INSTANT.toISOString(),
      scheduledFor: SCHEDULED_FOR.toISOString(),
    });
  });

  it("keeps the original schedule and does not audit a repeated request", async () => {
    const userId = await seedUser();

    const first = await post(REQUEST_PATH, userId);
    const second = await post(REQUEST_PATH, userId);

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    const row = await userRow(userId);
    expect(row.deletionScheduledFor?.getTime()).toBe(SCHEDULED_FOR.getTime());
    expect(await audits()).toHaveLength(1);
  });

  it("replays an idempotent request", async () => {
    const userId = await seedUser();

    const first = await post(REQUEST_PATH, userId, {
      idempotencyKey: "deletion-key-1",
    });
    const second = await post(REQUEST_PATH, userId, {
      idempotencyKey: "deletion-key-1",
    });

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(second.headers.get("idempotency-replayed")).toBe("true");
  });
});

describe("users.me.accountDeletion.request guards", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("refuses the last active admin without writing state", async () => {
    const userId = await seedUser({ role: "ADMIN" });

    const response = await post(REQUEST_PATH, userId);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USERS_CANNOT_DELETE_LAST_ADMIN",
      status: 409,
    });
    const row = await userRow(userId);
    expect(row.deletionScheduledFor).toBeNull();
    expect(await audits()).toHaveLength(0);
  });

  it("allows an admin when another active admin exists", async () => {
    const userId = await seedUser({ role: "ADMIN" });
    await seedUser({ role: "ADMIN" });

    const response = await post(REQUEST_PATH, userId);

    expect(response.status).toBe(204);
    expect((await userRow(userId)).deletionScheduledFor).not.toBeNull();
  });

  it("answers 401 for unknown and deleted users", async () => {
    const deleted = await seedUser({ status: "DELETED" });

    const unknown = await post(REQUEST_PATH, crypto.randomUUID());
    const deletedResponse = await post(REQUEST_PATH, deleted);

    expect(unknown.status).toBe(401);
    expect(deletedResponse.status).toBe(401);
    await expect(deletedResponse.json()).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("users.me.accountDeletion.cancel", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("clears the pending deletion and audits the cancel", async () => {
    const userId = await seedUser();
    await post(REQUEST_PATH, userId);

    const response = await post(CANCEL_PATH, userId);

    expect(response.status).toBe(204);
    const row = await userRow(userId);
    expect(row.deletionRequestedAt).toBeNull();
    expect(row.deletionScheduledFor).toBeNull();
    expect(row.deletionRequestedSessionId).toBeNull();
    expect(row.deletionRequestedTraceId).toBeNull();

    const actions = (await audits()).map((audit) => audit.action);
    expect(actions).toEqual(["REQUESTED", "CANCELED"]);

    const body = await me(userId);
    expect(body.accountDeletion).toBeNull();
  });

  it("is a no-op without a pending deletion and allows a fresh request", async () => {
    const userId = await seedUser();

    const first = await post(CANCEL_PATH, userId);
    expect(first.status).toBe(204);
    expect(await audits()).toHaveLength(0);

    await post(REQUEST_PATH, userId);
    await post(CANCEL_PATH, userId);
    const reRequest = await post(REQUEST_PATH, userId);

    expect(reRequest.status).toBe(204);
    const actions = (await audits()).map((audit) => audit.action);
    expect(actions).toEqual(["REQUESTED", "CANCELED", "REQUESTED"]);
  });
});
