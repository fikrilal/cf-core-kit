import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authEnv,
  cleanAuthTables,
  createRsaTestKey,
  fakeVerifier,
  googleClaims,
  jwksFor,
  jsonRecord,
  permissiveLimiterFactory,
  pick,
  pickString,
  signIdToken,
  TEST_GOOGLE_SUBJECT,
  TEST_SIGNING_KEYS_JSON,
  TEST_TOKEN_INSTANT,
  TEST_USER_EMAIL,
} from "../../../../test/auth-fixtures";
import { fixedClock } from "../../../platform/clock/clock";
import { send } from "../../../../test/app-request";
import { verifyAccessToken } from "../../../platform/auth/access-token";
import { buildKeyRing } from "../../../platform/auth/keys";
import { sha256Base64Url } from "../../../platform/crypto/crypto";
import { createDb } from "../../../platform/db/db";
import {
  oidcIdentities,
  refreshTokens,
  sessions,
  users,
} from "../../../platform/db/schema";
import { createApp } from "../../../platform/http/app";
import { registerAuthRoutes } from "../auth.routes";
import {
  createGoogleIdTokenVerifier,
  createJwksCache,
  type IdTokenVerifier,
  type JwksCache,
} from "./oidc";

function db() {
  return createDb(env.DB);
}

async function signIn(
  verifier: IdTokenVerifier,
  body: Record<string, unknown> = {
    provider: "GOOGLE",
    idToken: "stub",
    deviceId: "device-a",
    deviceName: "iPhone",
  },
  runtimeEnv = authEnv(),
): Promise<Response> {
  const app = createApp();

  registerAuthRoutes(app, {
    verifier,
    rateLimiterFactory: permissiveLimiterFactory(),
  });

  return send(
    app,
    "https://example.com/v1/auth/oidc/exchange",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    runtimeEnv,
  );
}

async function testKeyRing() {
  return buildKeyRing({
    authSigningKeysJson: TEST_SIGNING_KEYS_JSON,
    authSigningKeysJsonBase64: undefined,
  });
}

function staticJwks(
  key: Awaited<ReturnType<typeof createRsaTestKey>>,
): JwksCache {
  return createJwksCache({ fetchKeys: () => Promise.resolve(jwksFor(key)) });
}

function staticVerifier(
  key: Awaited<ReturnType<typeof createRsaTestKey>>,
): IdTokenVerifier {
  return createGoogleIdTokenVerifier({
    jwks: staticJwks(key),
    clock: fixedClock(TEST_TOKEN_INSTANT),
  });
}

describe("exchange: user creation", () => {
  let body: Record<string, unknown> = {};

  beforeEach(async () => {
    await cleanAuthTables(db());

    const response = await signIn(fakeVerifier());
    expect(response.status).toBe(200);

    body = await jsonRecord(response);
  });

  it("creates the user and identity with the Me projection", async () => {
    expect(body).toMatchObject({
      data: {
        user: {
          email: TEST_USER_EMAIL,
          emailVerified: true,
          roles: ["USER"],
          authMethods: ["GOOGLE"],
          accountDeletion: null,
        },
      },
    });

    const userRows = await db().select().from(users);
    expect(userRows).toHaveLength(1);
    expect(userRows[0]?.emailVerifiedAt).toBeInstanceOf(Date);

    const identityRows = await db().select().from(oidcIdentities);
    expect(identityRows).toHaveLength(1);
    expect(identityRows[0]?.subject).toBe(TEST_GOOGLE_SUBJECT);
    expect(identityRows[0]?.provider).toBe("GOOGLE");
  });

  it("issues a verifiable access token and stores only the refresh hash", async () => {
    const refreshToken = pickString(body, "data", "refreshToken");
    const accessToken = pickString(body, "data", "accessToken");
    const principal = await verifyAccessToken({
      token: accessToken,
      keyRing: await testKeyRing(),
      now: new Date(),
    });
    if (principal === undefined)
      throw new Error("expected a valid access token");

    const sessionRows = await db().select().from(sessions);
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.id).toBe(principal.sessionId);
    expect(sessionRows[0]?.userId).toBe(principal.userId);
    expect(sessionRows[0]?.deviceName).toBe("iPhone");
    expect(sessionRows[0]?.activeKey).toBe(`${principal.userId}:device-a`);

    const tokenRows = await db()
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, await sha256Base64Url(refreshToken)));
    expect(tokenRows).toHaveLength(1);
    expect(tokenRows[0]?.sessionId).toBe(principal.sessionId);
  });
});

describe("exchange: repeat sign-in and linking rules", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("reuses the user and revokes the previous device session", async () => {
    const verifier = fakeVerifier();

    const first = await signIn(verifier);
    const firstBody = await jsonRecord(first);
    const second = await signIn(verifier);
    const secondBody = await jsonRecord(second);

    expect(second.status).toBe(200);
    await expect(db().$count(users)).resolves.toBe(1);
    await expect(db().$count(sessions)).resolves.toBe(2);
    await expect(db().$count(refreshTokens)).resolves.toBe(2);

    const sessionRows = await db().select().from(sessions);
    const revoked = sessionRows.filter((row) => row.revokedAt !== null);
    const active = sessionRows.filter((row) => row.revokedAt === null);
    expect(revoked).toHaveLength(1);
    expect(revoked[0]?.activeKey).toBeNull();
    expect(active).toHaveLength(1);
    expect(active[0]?.activeKey).not.toBeNull();
    expect(pick(firstBody, "data", "user", "id")).toBe(
      pick(secondBody, "data", "user", "id"),
    );
  });

  it("matches existing accounts by normalized email", async () => {
    await db().insert(users).values({
      id: crypto.randomUUID(),
      email: TEST_USER_EMAIL,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await signIn(fakeVerifier({ email: "USER@EXAMPLE.COM" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_OIDC_LINK_REQUIRED",
    });
  });

  it("requires linking when the email already belongs to an account", async () => {
    await db().insert(users).values({
      id: crypto.randomUUID(),
      email: TEST_USER_EMAIL,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await signIn(fakeVerifier());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_OIDC_LINK_REQUIRED",
    });
    await expect(db().$count(oidcIdentities)).resolves.toBe(0);
  });
});

describe("exchange: account status and verification rules", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("rejects suspended and deleted accounts", async () => {
    const userId = crypto.randomUUID();
    const now = new Date();

    await db().insert(users).values({
      id: userId,
      email: TEST_USER_EMAIL,
      createdAt: now,
      updatedAt: now,
    });
    await db().insert(oidcIdentities).values({
      id: crypto.randomUUID(),
      userId,
      provider: "GOOGLE",
      subject: TEST_GOOGLE_SUBJECT,
      createdAt: now,
      updatedAt: now,
    });

    await db()
      .update(users)
      .set({ status: "SUSPENDED" })
      .where(eq(users.id, userId));
    const suspended = await signIn(fakeVerifier());
    expect(suspended.status).toBe(403);
    await expect(suspended.json()).resolves.toMatchObject({
      code: "AUTH_USER_SUSPENDED",
    });

    await db()
      .update(users)
      .set({ status: "DELETED" })
      .where(eq(users.id, userId));
    const deleted = await signIn(fakeVerifier());
    expect(deleted.status).toBe(401);
    await expect(deleted.json()).resolves.toMatchObject({
      code: "AUTH_OIDC_TOKEN_INVALID",
    });
  });

  it("rejects unverified provider emails without creating a user", async () => {
    const response = await signIn(fakeVerifier({ emailVerified: false }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_OIDC_EMAIL_NOT_VERIFIED",
    });
    await expect(db().$count(users)).resolves.toBe(0);
  });
});

describe("exchange: provider verification through the route", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("signs in with a real RS256 token against a stubbed JWKS", async () => {
    const key = await createRsaTestKey();
    const verifier = staticVerifier(key);
    const idToken = await signIdToken({ key, claims: googleClaims() });

    const response = await signIn(verifier, { provider: "GOOGLE", idToken });

    expect(response.status).toBe(200);
    await expect(db().$count(users)).resolves.toBe(1);
  });

  it("reports OIDC as not configured when client ids are absent", async () => {
    const key = await createRsaTestKey();
    const response = await signIn(
      staticVerifier(key),
      { provider: "GOOGLE", idToken: "stub" },
      authEnv({ AUTH_OIDC_GOOGLE_CLIENT_IDS: "" }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_OIDC_NOT_CONFIGURED",
    });
  });

  it("rejects malformed tokens as invalid", async () => {
    const key = await createRsaTestKey();
    const response = await signIn(staticVerifier(key), {
      provider: "GOOGLE",
      idToken: "not-a-jwt",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "AUTH_OIDC_TOKEN_INVALID",
    });
  });

  it("rejects unknown body fields with the field named", async () => {
    const response = await signIn(fakeVerifier(), {
      provider: "GOOGLE",
      idToken: "stub",
      extra: true,
    });

    expect(response.status).toBe(400);
    const body = await jsonRecord(response);

    expect(body).toMatchObject({ code: "VALIDATION_FAILED" });

    const errors = pick(body, "errors");
    if (!Array.isArray(errors)) throw new Error("expected errors array");

    const first: unknown = errors[0];
    if (typeof first !== "object" || first === null) {
      throw new Error("expected the first error");
    }

    const record: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(first)) record[key] = value;

    expect(record.field).toBe("extra");
  });

  it("rejects payloads outside the provider enum with the problem shape", async () => {
    const response = await signIn(fakeVerifier(), {
      provider: "APPLE",
      idToken: "stub",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      title: "Validation Failed",
    });
  });
});
