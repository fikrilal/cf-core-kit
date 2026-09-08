import { describe, expect, it } from "vitest";

import { send } from "../../../test/app-request";
import { createApp } from "../http/app";
import { evaluateReadiness, registerHealthRoutes } from "./health";

describe("evaluateReadiness", () => {
  it("returns true when the check resolves", async () => {
    await expect(evaluateReadiness(() => Promise.resolve(1))).resolves.toBe(
      true,
    );
  });

  it("returns false when the check rejects", async () => {
    await expect(
      evaluateReadiness(() => Promise.reject(new Error("down"))),
    ).resolves.toBe(false);
  });

  it("returns false when the check throws synchronously", async () => {
    await expect(
      evaluateReadiness(() => {
        throw new Error("binding missing");
      }),
    ).resolves.toBe(false);
  });
});

describe("registerHealthRoutes", () => {
  it("serves liveness without the envelope", async () => {
    const app = createApp();

    registerHealthRoutes(app);

    const response = await send(app, "https://example.com/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("serves readiness against the D1 binding", async () => {
    const app = createApp();

    registerHealthRoutes(app);

    const response = await send(app, "https://example.com/ready");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("renders failed readiness as a 503 problem", async () => {
    const app = createApp();

    registerHealthRoutes(app, { databaseReady: () => Promise.resolve(false) });

    const response = await send(app, "https://example.com/ready");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      type: "about:blank",
      title: "Service Unavailable",
      status: 503,
      detail: "Readiness checks failed",
      code: "INTERNAL",
      errors: [{ field: "db", message: "D1 not ready" }],
    });
  });
});
