import { describe, expect, it } from "vitest";

import worker from "./worker";

describe("worker", () => {
  it("reports name and version at the root", async () => {
    const response = worker.fetch(new Request("https://example.com/"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "cf-core-kit",
      version: "dev",
      commit: "none",
    });
  });

  it("returns 404 for unknown paths", () => {
    const response = worker.fetch(new Request("https://example.com/unknown"));

    expect(response.status).toBe(404);
  });
});
