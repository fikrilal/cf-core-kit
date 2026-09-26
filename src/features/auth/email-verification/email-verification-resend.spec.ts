import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  authEnv,
  cleanAuthTables,
  fakeVerifier,
  jsonRecord,
  TEST_TOKEN_INSTANT,
  userAccessToken,
} from "../../../../test/auth-fixtures";
import { send } from "../../../../test/app-request";
import { fakeQueue } from "../../../../test/queue-fixtures";
import { fixedClock } from "../../../platform/clock/clock";
import { parseConfig } from "../../../platform/config/config";
import { createDb } from "../../../platform/db/db";
import { users } from "../../../platform/db/schema";
import { createEmailPort, type EmailPort } from "../../../platform/email/email";
import { createApp } from "../../../platform/http/app";
import {
  durableObjectLimiterFactory,
  type LimiterFactory,
} from "../../../platform/rate-limit/require-rate-limit";
import type { RateLimitRequest } from "../../../platform/rate-limit/rate-limiter";
import { registerAuthRoutes } from "../auth.routes";

const CLOCK = fixedClock(TEST_TOKEN_INSTANT);
const NOW_ISO = TEST_TOKEN_INSTANT.toISOString();

type ResendOptions = Readonly<{
  email?: EmailPort;
  queue?: Queue;
  limiterFactory?: LimiterFactory;
}>;

function buildApp(options: ResendOptions = {}) {
  const app = createApp();

  registerAuthRoutes(app, {
    verifier: fakeVerifier(),
    clock: CLOCK,
    rateLimiterFactory: options.limiterFactory ?? durableObjectLimiterFactory(),
    email: options.email ?? enabledEmailPort(),
    queue: options.queue ?? fakeQueue().queue,
  });

  return app;
}

function enabledEmailPort(): EmailPort {
  return {
    isEnabled: () => true,
    send: () => Promise.resolve({ id: "email-1" }),
  };
}

async function resend(
  accessToken: string,
  options: ResendOptions & { ip?: string } = {},
) {
  return send(
    buildApp(options),
    "https://example.com/v1/auth/email/verification/resend",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(options.ip === undefined ? {} : { "CF-Connecting-IP": options.ip }),
      },
    },
    authEnv(),
  );
}

function db() {
  return createDb(env.DB);
}

async function seedUser(
  emailVerifiedAt: Date | null,
  status?: "ACTIVE" | "DELETED",
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date(TEST_TOKEN_INSTANT.getTime() - 60_000);

  await db()
    .insert(users)
    .values({
      id,
      email: `resend-${id}@example.com`,
      emailVerifiedAt,
      ...(status === undefined ? {} : { status }),
      createdAt: now,
      updatedAt: now,
    });

  return id;
}

function recordingLimiter(lines: RateLimitRequest[]): LimiterFactory {
  return () => (input) => {
    lines.push(input);

    return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
  };
}

describe("auth.email.verification.resend", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("returns 401 without a bearer token and does not enqueue", async () => {
    const { queue, sent } = fakeQueue();
    const response = await send(
      buildApp({ queue }),
      "https://example.com/v1/auth/email/verification/resend",
      { method: "POST" },
      authEnv(),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(sent).toHaveLength(0);
  });

  it("returns 500 before any other work when email is not configured", async () => {
    const limits: RateLimitRequest[] = [];
    const { queue, sent } = fakeQueue();
    const userId = await seedUser(null);
    const accessToken = await userAccessToken(userId, {
      emailVerified: false,
      now: TEST_TOKEN_INSTANT,
    });

    const response = await resend(accessToken, {
      email: createEmailPort(parseConfig({})),
      queue,
      limiterFactory: recordingLimiter(limits),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTERNAL",
      detail: "Email is not configured",
    });
    expect(sent).toHaveLength(0);
    expect(limits).toHaveLength(0);
  });
});

describe("auth.email.verification.resend identity guards", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("returns 401 for unknown and deleted users without enqueueing", async () => {
    const limits: RateLimitRequest[] = [];
    const { queue, sent } = fakeQueue();
    const deletedId = await seedUser(null, "DELETED");
    const options = {
      queue,
      limiterFactory: recordingLimiter(limits),
    };

    const unknown = await resend(
      await userAccessToken(crypto.randomUUID(), { now: TEST_TOKEN_INSTANT }),
      options,
    );
    const deleted = await resend(
      await userAccessToken(deletedId, { now: TEST_TOKEN_INSTANT }),
      options,
    );

    expect(unknown.status).toBe(401);
    expect(deleted.status).toBe(401);
    await expect(deleted.json()).resolves.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(sent).toHaveLength(0);
    expect(limits).toHaveLength(0);
  });

  it("returns 204 without enqueueing when the user is already verified", async () => {
    const limits: RateLimitRequest[] = [];
    const { queue, sent } = fakeQueue();
    const userId = await seedUser(TEST_TOKEN_INSTANT);

    const response = await resend(
      await userAccessToken(userId, { now: TEST_TOKEN_INSTANT }),
      {
        queue,
        limiterFactory: recordingLimiter(limits),
      },
    );

    expect(response.status).toBe(204);
    expect(sent).toHaveLength(0);
    expect(limits).toHaveLength(0);
  });
});

describe("auth.email.verification.resend enqueue", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("enqueues the verification email job for an unverified user", async () => {
    const limits: RateLimitRequest[] = [];
    const { queue, sent } = fakeQueue();
    const userId = await seedUser(null);

    const response = await resend(
      await userAccessToken(userId, { now: TEST_TOKEN_INSTANT }),
      {
        queue,
        limiterFactory: recordingLimiter(limits),
      },
    );

    expect(response.status).toBe(204);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({
      v: 1,
      job: "auth.sendVerificationEmail",
      enqueuedAt: NOW_ISO,
      payload: { userId, requestedAt: NOW_ISO },
    });
    expect(limits.map((line) => line.key)).toEqual([
      `auth.email.verification.resend:user:${userId}`,
    ]);
  });

  it("reports 500 when the queue rejects the message", async () => {
    const { queue } = fakeQueue(() => {
      throw new Error("queue unavailable");
    });
    const userId = await seedUser(null);

    const response = await resend(
      await userAccessToken(userId, { now: TEST_TOKEN_INSTANT }),
      { queue },
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTERNAL",
    });
  });
});

describe("auth.email.verification.resend rate limits", () => {
  beforeEach(async () => {
    await cleanAuthTables(db());
  });

  it("checks the per-IP policy first, then the per-user cooldown", async () => {
    const limits: RateLimitRequest[] = [];
    const { queue, sent } = fakeQueue();
    const userId = await seedUser(null);

    const response = await resend(
      await userAccessToken(userId, { now: TEST_TOKEN_INSTANT }),
      {
        queue,
        limiterFactory: recordingLimiter(limits),
        ip: "203.0.113.5",
      },
    );

    expect(response.status).toBe(204);
    expect(sent).toHaveLength(1);
    expect(limits.map((line) => line.key)).toEqual([
      "auth.email.verification.resend:ip:203.0.113.5",
      `auth.email.verification.resend:user:${userId}`,
    ]);
    expect(limits[0]).toMatchObject({
      limit: 30,
      windowSeconds: 300,
      blockSeconds: 900,
    });
    expect(limits[1]).toMatchObject({ limit: 1, windowSeconds: 60 });
  });

  it("answers 429 with Retry-After when the per-IP policy denies", async () => {
    const { queue, sent } = fakeQueue();
    const userId = await seedUser(null);
    const denied: LimiterFactory = () => () =>
      Promise.resolve({ allowed: false, retryAfterSeconds: 42 });

    const response = await resend(
      await userAccessToken(userId, { now: TEST_TOKEN_INSTANT }),
      {
        queue,
        limiterFactory: denied,
        ip: "203.0.113.9",
      },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    const body = await jsonRecord(response);
    expect(body.code).toBe("RATE_LIMITED");
    expect(sent).toHaveLength(0);
  });

  it("enforces the real cooldown on a second resend", async () => {
    const { queue, sent } = fakeQueue();
    const userId = await seedUser(null);
    const accessToken = await userAccessToken(userId, {
      now: TEST_TOKEN_INSTANT,
    });

    const first = await resend(accessToken, { queue });
    const second = await resend(accessToken, { queue });

    expect(first.status).toBe(204);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    await expect(second.json()).resolves.toMatchObject({
      code: "RATE_LIMITED",
    });
    expect(sent).toHaveLength(1);
  });
});
