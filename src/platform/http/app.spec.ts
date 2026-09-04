import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ErrorCode } from "../../shared/error-codes";
import { AppError } from "../errors/app-error";
import { createApp } from "./app";
import { data } from "./envelope";
import { readJson } from "./validation";

function createTestApp() {
  const app = createApp();

  app.get("/ok", () => data({ ok: true }));
  app.get("/boom", () => {
    throw new AppError({
      status: 409,
      code: ErrorCode.CONFLICT,
      message: "Already exists",
    });
  });
  app.get("/crash", () => {
    throw new Error("internal details");
  });
  app.post("/validate", async (context) => {
    const body = await readJson(context, z.object({ name: z.string().min(1) }));

    return data({ greeting: `hello ${body.name}` });
  });

  return app;
}

describe("createApp", () => {
  it("echoes a valid inbound request id on success", async () => {
    const response = await createTestApp().request("https://example.com/ok", {
      headers: { "x-request-id": "abc-123" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-Id")).toBe("abc-123");
    await expect(response.json()).resolves.toEqual({ data: { ok: true } });
  });

  it("generates a request id when absent", async () => {
    const response = await createTestApp().request("https://example.com/ok");

    expect(response.headers.get("X-Request-Id")).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("replaces an invalid request id", async () => {
    const response = await createTestApp().request("https://example.com/ok", {
      headers: { "x-request-id": "bad id" },
    });

    expect(response.headers.get("X-Request-Id")).not.toBe("bad id");
    expect(response.headers.get("X-Request-Id")).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it("renders thrown AppErrors as problems with the echoed id", async () => {
    const response = await createTestApp().request("https://example.com/boom", {
      headers: { "x-request-id": "req-boom" },
    });

    expect(response.status).toBe(409);
    expect(response.headers.get("Content-Type")).toBe(
      "application/problem+json",
    );
    expect(response.headers.get("X-Request-Id")).toBe("req-boom");
    await expect(response.json()).resolves.toEqual({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      detail: "Already exists",
      code: "CONFLICT",
      traceId: "req-boom",
    });
  });

  it("renders unknown errors as a generic internal problem", async () => {
    const response = await createTestApp().request("https://example.com/crash");
    const requestId = response.headers.get("X-Request-Id");

    expect(response.status).toBe(500);
    expect(response.headers.get("Content-Type")).toBe(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toEqual({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      code: "INTERNAL",
      traceId: requestId,
    });
  });

  it("renders unmatched routes as not-found problems", async () => {
    const response = await createTestApp().request(
      "https://example.com/missing",
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      title: "Not Found",
    });
  });
});

describe("createApp request validation", () => {
  it("accepts valid JSON bodies through readJson", async () => {
    const response = await createTestApp().request(
      "https://example.com/validate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "ada" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { greeting: "hello ada" },
    });
  });

  it("renders schema violations as validation problems with errors[]", async () => {
    const response = await createTestApp().request(
      "https://example.com/validate",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-request-id": "req-validate",
        },
        body: JSON.stringify({ name: "" }),
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe(
      "application/problem+json",
    );
    await expect(response.clone().json()).resolves.toMatchObject({
      type: "about:blank",
      title: "Validation Failed",
      status: 400,
      code: "VALIDATION_FAILED",
      traceId: "req-validate",
    });
    await expect(response.json()).resolves.toMatchObject({
      errors: [{ field: "name" }],
    });
  });

  it("renders malformed JSON bodies as validation problems without errors[]", async () => {
    const response = await createTestApp().request(
      "https://example.com/validate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      },
    );
    const requestId = response.headers.get("X-Request-Id");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      type: "about:blank",
      title: "Validation Failed",
      status: 400,
      code: "VALIDATION_FAILED",
      traceId: requestId,
    });
  });
});
