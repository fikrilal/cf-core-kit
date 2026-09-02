import { describe, expect, it } from "vitest";

import worker from "./worker";

const testEnv: Env = { APP_ENV: "dev", LOG_LEVEL: "info" };

describe("worker", () => {
  it("reports name, version, and app env at the root", async () => {
    const response = worker.fetch(new Request("https://example.com/"), testEnv);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "cf-core-kit",
      version: "dev",
      commit: "none",
      appEnv: "dev",
    });
  });

  it("returns 404 for unknown paths", () => {
    const response = worker.fetch(
      new Request("https://example.com/unknown"),
      testEnv,
    );

    expect(response.status).toBe(404);
  });
});
