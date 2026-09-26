import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authEnv,
  cleanAuthTables,
  fakeVerifier,
  permissiveLimiterFactory,
  TEST_GOOGLE_SUBJECT,
  TEST_SIGNING_KEYS_JSON,
  TEST_USER_EMAIL,
} from "../../../../test/auth-fixtures";
import { send, type RuntimeEnv } from "../../../../test/app-request";
import { issueAccessToken } from "../../../platform/auth/access-token";
import { buildKeyRing } from "../../../platform/auth/keys";
import { createDb } from "../../../platform/db/db";
import { oidcIdentities, users } from "../../../platform/db/schema";
import { createApp } from "../../../platform/http/app";
import { registerAuthRoutes } from "../auth.routes";
import type { IdTokenVerifier } from "./oidc";

function db() {
  return createDb(env.DB);
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
      email: `seed-${id}@example.com`,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });

  return id;
}

async function seedIdentity(userId: string, subject: string): Promise<void> {
  const now = new Date();

  await db().insert(oidcIdentities).values({
    id: crypto.randomUUID(),
    userId,
    provider: "GOOGLE",
    subject,
    createdAt: now,
    updatedAt: now,
  });
}

async function testAccessToken(userId: string): Promise<string> {
  const keyRing = await buildKeyRing({
    authSigningKeysJson: TEST_SIGNING_KEYS_JSON,
    authSigningKeysJsonBase64: undefined,
  });

  return issueAccessToken({
    keyRing,
    now: new Date(),
    ttlSeconds: 900,
    userId,
    sessionId: crypto.randomUUID(),
    emailVerified: true,
    roles: ["USER"],
  });
}

function rejectingVerifier(
  reason: "not_configured" | "invalid",
): IdTokenVerifier {
  return () => Promise.resolve({ ok: false, reason });
}

type ConnectOptions = Readonly<{
  token?: string;
  authorization?: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  verifier?: IdTokenVerifier;
  runtimeEnv?: RuntimeEnv;
}>;

function connectRequest(
  options: ConnectOptions = {},
): Response | Promise<Response> {
  const app = createApp();

  registerAuthRoutes(app, {
    verifier: options.verifier ?? fakeVerifier(),
    rateLimiterFactory: permissiveLimiterFactory(),
  });

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (options.authorization !== undefined) {
    headers.Authorization = options.authorization;
  } else if (options.token !== undefined) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options.idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  return send(
    app,
    "https://example.com/v1/auth/oidc/connect",
    {
      method: "POST",
      headers,
      body: JSON.stringify(
        options.body ?? { provider: "GOOGLE", idToken: "stub" },
      ),
    },
    options.runtimeEnv ?? authEnv(),
  );
}

describe("connect: authentication", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("requires a bearer token", async () => {
    const response = await connectRequest();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects an invalid bearer token", async () => {
    const response = await connectRequest({ token: "garbage" });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});

describe("connect: linking behavior", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("links the identity and backfills a matching verified email", async () => {
    const userId = await seedUser({ email: TEST_USER_EMAIL });
    const response = await connectRequest({
      token: await testAccessToken(userId),
    });

    expect(response.status).toBe(204);

    const identityRows = await db().select().from(oidcIdentities);
    expect(identityRows).toHaveLength(1);
    expect(identityRows[0]?.userId).toBe(userId);
    expect(identityRows[0]?.subject).toBe(TEST_GOOGLE_SUBJECT);

    const userRows = await db()
      .select()
      .from(users)
      .where(eq(users.id, userId));
    expect(userRows[0]?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("accepts a lowercase bearer scheme", async () => {
    const userId = await seedUser();
    const token = await testAccessToken(userId);

    const response = await connectRequest({
      authorization: `bearer ${token}`,
    });

    expect(response.status).toBe(204);
    await expect(db().$count(oidcIdentities)).resolves.toBe(1);
  });

  it("does not backfill verification when the emails differ", async () => {
    const userId = await seedUser({ email: "different@example.com" });
    const response = await connectRequest({
      token: await testAccessToken(userId),
    });

    expect(response.status).toBe(204);

    const userRows = await db()
      .select()
      .from(users)
      .where(eq(users.id, userId));
    expect(userRows[0]?.emailVerifiedAt).toBeNull();
  });

  it("is idempotent for an already-linked identity", async () => {
    const userId = await seedUser();
    const token = await testAccessToken(userId);

    const first = await connectRequest({ token });
    const second = await connectRequest({ token });

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    await expect(db().$count(oidcIdentities)).resolves.toBe(1);
  });
});

describe("connect: conflict rules", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("rejects an identity linked to another account", async () => {
    const ownerId = await seedUser();
    await seedIdentity(ownerId, TEST_GOOGLE_SUBJECT);
    const otherId = await seedUser();

    const response = await connectRequest({
      token: await testAccessToken(otherId),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_OIDC_IDENTITY_ALREADY_LINKED",
    });
  });

  it("rejects a second identity for the same provider", async () => {
    const userId = await seedUser();
    await seedIdentity(userId, "some-other-subject");

    const response = await connectRequest({
      token: await testAccessToken(userId),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_OIDC_PROVIDER_ALREADY_LINKED",
    });
  });

  it("replays an idempotent retry with the same key", async () => {
    const userId = await seedUser();
    const token = await testAccessToken(userId);
    const options = { token, idempotencyKey: "connect-key-1" } as const;

    const first = await connectRequest(options);
    const second = await connectRequest(options);

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    await expect(db().$count(oidcIdentities)).resolves.toBe(1);
  });
});

describe("connect: provider failure paths", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("rejects unverified provider emails", async () => {
    const userId = await seedUser();
    const response = await connectRequest({
      token: await testAccessToken(userId),
      verifier: fakeVerifier({ emailVerified: false }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_OIDC_EMAIL_NOT_VERIFIED",
    });
  });

  it("rejects malformed id tokens as invalid", async () => {
    const userId = await seedUser();
    const response = await connectRequest({
      token: await testAccessToken(userId),
      verifier: rejectingVerifier("invalid"),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_OIDC_TOKEN_INVALID",
    });
  });

  it("reports OIDC as not configured when client ids are absent", async () => {
    const userId = await seedUser();
    const response = await connectRequest({
      token: await testAccessToken(userId),
      verifier: rejectingVerifier("not_configured"),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_OIDC_NOT_CONFIGURED",
    });
  });

  it("rejects invalid payloads with the dialect problem shape", async () => {
    const userId = await seedUser();
    const response = await connectRequest({
      token: await testAccessToken(userId),
      body: { provider: "APPLE", idToken: "stub" },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      title: "Validation Failed",
    });
  });
});
