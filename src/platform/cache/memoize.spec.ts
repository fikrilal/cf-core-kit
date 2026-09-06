import { describe, expect, it } from "vitest";

import { memoize } from "./memoize";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("memoize", () => {
  it("caches within the ttl", async () => {
    let calls = 0;
    const cached = memoize(
      () => {
        calls += 1;
        return Promise.resolve("value");
      },
      { ttlMs: 10_000 },
    );

    expect(await cached.get()).toBe("value");
    expect(await cached.get()).toBe("value");
    expect(calls).toBe(1);
  });

  it("single-flights concurrent reads", async () => {
    let calls = 0;
    const cached = memoize(
      async () => {
        calls += 1;
        await sleep(20);
        return "value";
      },
      { ttlMs: 10_000 },
    );

    const [first, second] = await Promise.all([cached.get(), cached.get()]);

    expect(first).toBe("value");
    expect(second).toBe("value");
    expect(calls).toBe(1);
  });

  it("refreshes after expiry", async () => {
    let calls = 0;
    const cached = memoize(
      () => {
        calls += 1;
        return Promise.resolve(`value-${String(calls)}`);
      },
      { ttlMs: 20 },
    );

    expect(await cached.get()).toBe("value-1");
    await sleep(40);
    expect(await cached.get()).toBe("value-2");
    expect(calls).toBe(2);
  });

  it("does not cache failures", async () => {
    let calls = 0;
    const cached = memoize(
      () => {
        calls += 1;
        return Promise.reject(new Error("boom"));
      },
      { ttlMs: 10_000 },
    );

    await expect(cached.get()).rejects.toThrow("boom");
    await expect(cached.get()).rejects.toThrow("boom");
    expect(calls).toBe(2);
  });
});
