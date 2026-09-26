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
} from "../../../../test/auth-fixtures";
import { send } from "../../../../test/app-request";
import { fixedClock } from "../../../platform/clock/clock";
import { sha256Base64Url } from "../../../platform/crypto/crypto";
import { createDb } from "../../../platform/db/db";
import { emailVerificationTokens, users } from "../../../platform/db/schema";
import { createApp } from "../../../platform/http/app";
import { registerAuthRoutes } from "../auth.routes";

const CLOCK = fixedClock(TEST_TOKEN_INSTANT);
const SEED_NOW = new Date(TEST_TOKEN_INSTANT.getTime() - 60_000);
const USER_EMAIL = "verify-user@example.com";

function db() {
  return createDb(env.DB);
}

function verifyRequest(body: Record<string, unknown>) {
  const app = createApp();

  registerAuthRoutes(app, {
    verifier: fakeVerifier(),
    clock: CLOCK,
    rateLimiterFactory: permissiveLimiterFactory(),
  });

  return send(
    app,
    "https://example.com/v1/auth/email/verify",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    authEnv(),
  );
}

async function seedUser(emailVerifiedAt: Date | null): Promise<string> {
  const id = crypto.randomUUID();

  await db().insert(users).values({
    id,
    email: USER_EMAIL,
    emailVerifiedAt,
    createdAt: SEED_NOW,
    updatedAt: SEED_NOW,
  });

  return id;
}

async function seedToken(
  input: Readonly<{
    userId: string;
    token: string;
    expiresAt: Date;
    usedAt?: Date;
    revokedAt?: Date;
  }>,
): Promise<string> {
  const id = crypto.randomUUID();

  await db()
    .insert(emailVerificationTokens)
    .values({
      id,
      userId: input.userId,
      tokenHash: await sha256Base64Url(input.token),
      expiresAt: input.expiresAt,
      usedAt: input.usedAt ?? null,
      revokedAt: input.revokedAt ?? null,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });

  return id;
}

function unexpired(): Date {
  return new Date(TEST_TOKEN_INSTANT.getTime() + 3600_000);
}

async function userRow(userId: string) {
  const rows = await db().select().from(users).where(eq(users.id, userId));

  return rows[0];
}

async function tokenRow(id: string) {
  const rows = await db()
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.id, id));

  return rows[0];
}

describe("auth.email.verify", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("verifies the email and consumes the token", async () => {
    const userId = await seedUser(null);
    const tokenId = await seedToken({
      userId,
      token: "verify-token-1",
      expiresAt: unexpired(),
    });

    const response = await verifyRequest({ token: "verify-token-1" });

    expect(response.status).toBe(204);
    expect((await response.text()).length).toBe(0);

    const verified = await userRow(userId);
    expect(verified?.emailVerifiedAt?.getTime()).toBe(
      TEST_TOKEN_INSTANT.getTime(),
    );

    const consumed = await tokenRow(tokenId);
    expect(consumed?.usedAt?.getTime()).toBe(TEST_TOKEN_INSTANT.getTime());

    const replay = await verifyRequest({ token: "verify-token-1" });
    expect(replay.status).toBe(204);
  });

  it("accepts a valid token for an already verified user and consumes it", async () => {
    const userId = await seedUser(TEST_TOKEN_INSTANT);
    const tokenId = await seedToken({
      userId,
      token: "verify-token-2",
      expiresAt: unexpired(),
    });

    const response = await verifyRequest({ token: "verify-token-2" });

    expect(response.status).toBe(204);
    const consumed = await tokenRow(tokenId);
    expect(consumed?.usedAt).toBeInstanceOf(Date);
  });
});

describe("auth.email.verify rejections", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("rejects unknown tokens with the dialect problem shape", async () => {
    const response = await verifyRequest({ token: "unknown-token" });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_EMAIL_VERIFICATION_TOKEN_INVALID",
      status: 400,
    });
  });

  it("rejects already used tokens and leaves the user unverified", async () => {
    const userId = await seedUser(null);
    await seedToken({
      userId,
      token: "used-token",
      expiresAt: unexpired(),
      usedAt: SEED_NOW,
    });

    const response = await verifyRequest({ token: "used-token" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_EMAIL_VERIFICATION_TOKEN_INVALID",
    });
    const user = await userRow(userId);
    expect(user?.emailVerifiedAt).toBeNull();
  });

  it("rejects revoked tokens", async () => {
    const userId = await seedUser(null);
    await seedToken({
      userId,
      token: "revoked-token",
      expiresAt: unexpired(),
      revokedAt: SEED_NOW,
    });

    const response = await verifyRequest({ token: "revoked-token" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_EMAIL_VERIFICATION_TOKEN_INVALID",
    });
  });

  it("rejects expired tokens with a distinct code", async () => {
    const userId = await seedUser(null);
    await seedToken({
      userId,
      token: "expired-token",
      expiresAt: SEED_NOW,
    });

    const response = await verifyRequest({ token: "expired-token" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_EMAIL_VERIFICATION_TOKEN_EXPIRED",
      status: 400,
    });
  });
});

describe("auth.email.verify validation", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("validates empty and missing tokens with field issues", async () => {
    const empty = await verifyRequest({ token: "" });
    expect(empty.status).toBe(400);
    const emptyBody = await jsonRecord(empty);
    expect(emptyBody.code).toBe("VALIDATION_FAILED");
    expect(emptyBody.errors).toEqual([
      expect.objectContaining({ field: "token" }),
    ]);

    const missing = await verifyRequest({});
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("rejects unknown fields", async () => {
    const response = await verifyRequest({ token: "whatever", extra: true });

    expect(response.status).toBe(400);
    const body = await jsonRecord(response);
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.errors).toEqual([expect.objectContaining({ field: "extra" })]);
  });
});
