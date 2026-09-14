import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { jsonRecord } from "../../../test/auth-fixtures";
import { evaluateRateLimit } from "./rate-limiter";

function check(
  key: string,
  limit: number,
  windowSeconds = 60,
): Promise<Response> {
  const namespace = env.AUTH_RATE_LIMITER;
  const stub = namespace.get(namespace.idFromName(key));

  return stub.fetch("https://rate-limiter/check", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, limit, windowSeconds }),
  });
}

describe("AuthRateLimiter", () => {
  it("allows up to the limit, then blocks with a retry hint", async () => {
    const key = `test-${crypto.randomUUID()}`;

    const first = await jsonRecord(await check(key, 2));
    const second = await jsonRecord(await check(key, 2));
    const third = await check(key, 2);
    const thirdBody = await jsonRecord(third);

    expect(first).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(second).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(thirdBody.allowed).toBe(false);
    expect(Number(thirdBody.retryAfterSeconds)).toBeGreaterThanOrEqual(1);
  });

  it("isolates buckets per key", async () => {
    const blockedKey = `test-${crypto.randomUUID()}`;
    const otherKey = `test-${crypto.randomUUID()}`;

    await check(blockedKey, 1);
    const blockedSecond = await jsonRecord(await check(blockedKey, 1));
    const otherFirst = await jsonRecord(await check(otherKey, 1));

    expect(blockedSecond.allowed).toBe(false);
    expect(otherFirst.allowed).toBe(true);
  });

  it("rejects malformed requests", async () => {
    const response = await check("test-key", 0);

    expect(response.status).toBe(400);
  });
});

describe("evaluateRateLimit", () => {
  const input = { key: "k", limit: 2, windowSeconds: 60 };

  it("starts a fresh window with the first hit", () => {
    const { bucket, decision } = evaluateRateLimit(input, undefined, 1_000);

    expect(bucket).toEqual({ count: 1, resetAt: 61_000 });
    expect(decision).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("keeps the window fixed across hits", () => {
    const first = evaluateRateLimit(input, undefined, 1_000);
    const second = evaluateRateLimit(input, first.bucket, 31_000);

    expect(second.bucket.count).toBe(2);
    expect(second.bucket.resetAt).toBe(61_000);
    expect(second.decision.allowed).toBe(true);
  });

  it("rolls over when the window elapses", () => {
    const rolled = evaluateRateLimit(
      input,
      { count: 2, resetAt: 61_000 },
      61_000,
    );

    expect(rolled.bucket).toEqual({ count: 1, resetAt: 121_000 });
    expect(rolled.decision).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it("counts down the retry hint inside a window", () => {
    const blocked = evaluateRateLimit(
      input,
      { count: 2, resetAt: 11_000 },
      5_000,
    );

    expect(blocked.decision).toEqual({ allowed: false, retryAfterSeconds: 6 });
  });
});
