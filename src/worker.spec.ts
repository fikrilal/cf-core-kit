import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import worker from "./worker";

describe("worker", () => {
  it("serves the root banner inside the envelope", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/"),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    await expect(response.json()).resolves.toEqual({
      data: {
        name: "cf-core-kit",
        version: "dev",
        commit: "none",
        appEnv: "dev",
      },
    });
  });

  it("renders unknown paths as not-found problems", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/unknown"),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("serves health and readiness through the composition", async () => {
    const health = await worker.fetch(
      new Request("https://example.com/health"),
      env,
    );
    const ready = await worker.fetch(
      new Request("https://example.com/ready"),
      env,
    );

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "ok" });
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({ status: "ok" });
  });
});
