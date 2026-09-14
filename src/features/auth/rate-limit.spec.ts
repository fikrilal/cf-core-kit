import { describe, expect, it } from "vitest";

import {
  authEnv,
  fakeVerifier,
  TEST_TOKEN_INSTANT,
} from "../../../test/auth-fixtures";
import { send } from "../../../test/app-request";
import { fixedClock } from "../../platform/clock/clock";
import { createApp } from "../../platform/http/app";
import type { RateLimitRequest } from "../../platform/rate-limit/rate-limiter";
import {
  durableObjectLimiterFactory,
  type LimiterFactory,
} from "../../platform/rate-limit/require-rate-limit";
import type { AuthRateLimits } from "./auth.rate-limits";
import { registerAuthRoutes } from "./auth.routes";

const CLOCK = fixedClock(TEST_TOKEN_INSTANT);

type BuildOptions = Readonly<{
  rateLimits?: Partial<AuthRateLimits>;
  rateLimiterFactory?: LimiterFactory;
}>;

function buildApp(options: BuildOptions = {}) {
  const app = createApp();

  registerAuthRoutes(app, {
    verifier: fakeVerifier(),
    clock: CLOCK,
    ...options,
  });

  return app;
}

function post(
  app: ReturnType<typeof createApp>,
  path: string,
  body: Record<string, unknown>,
  clientAddress: string | undefined,
): Response | Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (clientAddress !== undefined) {
    headers["CF-Connecting-IP"] = clientAddress;
  }

  return send(
    app,
    `https://example.com${path}`,
    { method: "POST", headers, body: JSON.stringify(body) },
    authEnv(),
  );
}

function postLogout(
  app: ReturnType<typeof createApp>,
  clientAddress: string | undefined,
): Response | Promise<Response> {
  return post(
    app,
    "/v1/auth/logout",
    { refreshToken: `unknown-${crypto.randomUUID()}` },
    clientAddress,
  );
}

async function driveLimitedRoutes(
  app: ReturnType<typeof createApp>,
  address: string,
): Promise<number[]> {
  const exchange = await post(
    app,
    "/v1/auth/oidc/exchange",
    { provider: "APPLE" },
    address,
  );
  const connect = await post(
    app,
    "/v1/auth/oidc/connect",
    { provider: "GOOGLE", idToken: "stub" },
    address,
  );
  const refresh = await post(
    app,
    "/v1/auth/refresh",
    { refreshToken: "unknown-token" },
    address,
  );
  const logout = await postLogout(app, address);

  return [exchange.status, connect.status, refresh.status, logout.status];
}

function recordingLimiter(calls: RateLimitRequest[]): LimiterFactory {
  return () => (input) => {
    calls.push(input);

    return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
  };
}

function tightPolicy(limit: number): Partial<AuthRateLimits> {
  return {
    logout: {
      name: `test.logout.${crypto.randomUUID()}`,
      limit,
      windowSeconds: 60,
    },
  };
}

describe("auth rate limiting: enforcement", () => {
  it("returns the 429 dialect after the policy ceiling", async () => {
    const app = buildApp({
      rateLimits: tightPolicy(2),
      rateLimiterFactory: durableObjectLimiterFactory(),
    });
    const clientAddress = crypto.randomUUID();

    const first = await postLogout(app, clientAddress);
    const second = await postLogout(app, clientAddress);
    const third = await postLogout(app, clientAddress);

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(third.status).toBe(429);
    expect(Number(third.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    await expect(third.json()).resolves.toMatchObject({
      code: "RATE_LIMITED",
      title: "Too Many Requests",
      status: 429,
    });
  });

  it("isolates buckets per client address", async () => {
    const app = buildApp({
      rateLimits: tightPolicy(1),
      rateLimiterFactory: durableObjectLimiterFactory(),
    });
    const blockedAddress = crypto.randomUUID();
    const otherAddress = crypto.randomUUID();

    await postLogout(app, blockedAddress);
    const blockedSecond = await postLogout(app, blockedAddress);
    const otherFirst = await postLogout(app, otherAddress);

    expect(blockedSecond.status).toBe(429);
    expect(otherFirst.status).toBe(401);
  });
});

describe("auth rate limiting: wiring", () => {
  it("applies each configured policy only to its route", async () => {
    const calls: RateLimitRequest[] = [];
    const app = buildApp({ rateLimiterFactory: recordingLimiter(calls) });
    const address = crypto.randomUUID();

    const statuses = await driveLimitedRoutes(app, address);

    expect(statuses).toEqual([400, 401, 401, 401]);
    expect(calls).toEqual([
      { key: `auth.oidc.exchange:${address}`, limit: 20, windowSeconds: 60 },
      { key: `auth.oidc.connect:${address}`, limit: 20, windowSeconds: 60 },
      { key: `auth.refresh:${address}`, limit: 60, windowSeconds: 60 },
      { key: `auth.logout:${address}`, limit: 60, windowSeconds: 60 },
    ]);

    const jwks = await send(
      app,
      "https://example.com/.well-known/jwks.json",
      undefined,
      authEnv(),
    );

    expect(jwks.status).toBe(200);
    expect(calls).toHaveLength(4);
  });

  it("skips limiting for requests without a client address", async () => {
    const calls: RateLimitRequest[] = [];
    const app = buildApp({ rateLimiterFactory: recordingLimiter(calls) });

    const response = await postLogout(app, undefined);

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});

describe("auth rate limiting: failure isolation", () => {
  it("fails open when the limiter returns a malformed decision", async () => {
    const malformedFactory: LimiterFactory = () => () =>
      Promise.resolve({
        allowed: false,
        retryAfterSeconds: Number.NaN,
      });
    const app = buildApp({
      rateLimits: tightPolicy(1),
      rateLimiterFactory: malformedFactory,
    });

    const response = await postLogout(app, crypto.randomUUID());

    expect(response.status).toBe(401);
  });

  it("fails open when the limiter errors", async () => {
    const failingFactory: LimiterFactory = () => () =>
      Promise.reject(new Error("limiter down"));
    const app = buildApp({
      rateLimits: tightPolicy(1),
      rateLimiterFactory: failingFactory,
    });

    const response = await postLogout(app, crypto.randomUUID());

    expect(response.status).toBe(401);
  });
});
