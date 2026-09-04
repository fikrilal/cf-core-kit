import { describe, expect, it } from "vitest";

import worker from "./worker";

const testEnv: Env = { APP_ENV: "dev", LOG_LEVEL: "info" };

describe("worker", () => {
  it("serves the root banner inside the envelope", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/"),
      testEnv,
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
      testEnv,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });
});
