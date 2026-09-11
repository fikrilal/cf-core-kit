import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createWorkerApp } from "../../src/app";
import { AppError } from "../../src/platform/errors/app-error";
import {
  created,
  data,
  list,
  noContent,
} from "../../src/platform/http/envelope";
import { readJson } from "../../src/platform/http/validation";
import { ErrorCode } from "../../src/shared/error-codes";
import { send } from "../app-request";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readObject(
  response: Response,
): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();

  if (!isRecord(body)) throw new Error("expected an object body");

  return body;
}

function fixtureApp(): ReturnType<typeof createWorkerApp> {
  const app = createWorkerApp();

  app.get("/__contract__/item", () => data({ id: "1" }));

  app.get("/__contract__/items", (context) => {
    const withCursor = context.req.query("cursor") === "1";

    return list(
      withCursor
        ? { items: [{ id: "1" }], limit: 2, hasMore: true, nextCursor: "abc" }
        : { items: [{ id: "1" }], limit: 2, hasMore: false },
    );
  });

  app.post("/__contract__/items", () =>
    created({ id: "1" }, "/__contract__/items/1"),
  );

  app.delete("/__contract__/items/1", () => noContent());

  app.get("/__contract__/conflict", () => {
    throw new AppError({
      status: 409,
      code: ErrorCode.CONFLICT,
      message: "duplicate",
      retryAfterSeconds: 5,
    });
  });

  app.get("/__contract__/explode", () => {
    throw new Error("secret internals");
  });

  app.post("/__contract__/validated", async (context) =>
    data(await readJson(context, z.object({ name: z.string() }))),
  );

  return app;
}

describe("dialect: success envelopes", () => {
  it("renders { data } with application/json", async () => {
    const response = await send(
      fixtureApp(),
      "https://example.com/__contract__/item",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ data: { id: "1" } });
  });

  it("renders list meta with exactly limit and hasMore when exhausted", async () => {
    const response = await send(
      fixtureApp(),
      "https://example.com/__contract__/items",
    );

    await expect(response.json()).resolves.toEqual({
      data: [{ id: "1" }],
      meta: { limit: 2, hasMore: false },
    });
  });

  it("renders nextCursor inside meta when more pages exist", async () => {
    const response = await send(
      fixtureApp(),
      "https://example.com/__contract__/items?cursor=1",
    );

    await expect(response.json()).resolves.toEqual({
      data: [{ id: "1" }],
      meta: { limit: 2, hasMore: true, nextCursor: "abc" },
    });
  });

  it("renders 201 created with Location", async () => {
    const response = await send(
      fixtureApp(),
      "https://example.com/__contract__/items",
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe("/__contract__/items/1");
    await expect(response.json()).resolves.toEqual({ data: { id: "1" } });
  });

  it("renders 204 with no body and no content type", async () => {
    const response = await send(
      fixtureApp(),
      "https://example.com/__contract__/items/1",
      { method: "DELETE" },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("content-type")).toBeNull();
    await expect(response.text()).resolves.toBe("");
  });
});

describe("dialect: problem details", () => {
  it("renders AppError problems with code, traceId, and Retry-After", async () => {
    const response = await send(
      fixtureApp(),
      "https://example.com/__contract__/conflict",
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(response.headers.get("Retry-After")).toBe("5");
    await expect(response.json()).resolves.toEqual({
      type: "about:blank",
      title: "Conflict",
      status: 409,
      detail: "duplicate",
      code: "CONFLICT",
      traceId: response.headers.get("X-Request-Id"),
    });
  });

  it("renders unknown errors as a generic 500 problem without detail", async () => {
    const response = await send(
      fixtureApp(),
      "https://example.com/__contract__/explode",
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      code: "INTERNAL",
      traceId: response.headers.get("X-Request-Id"),
    });
  });

  it("renders 404 NOT_FOUND for unmatched routes", async () => {
    const response = await send(
      fixtureApp(),
      "https://example.com/__contract__/ghost",
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "NOT_FOUND",
      traceId: response.headers.get("X-Request-Id"),
    });
  });
});

describe("dialect: validation failures", () => {
  it("renders per-field errors without a detail", async () => {
    const response = await send(
      fixtureApp(),
      "https://example.com/__contract__/validated",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 123 }),
      },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );

    const body = await readObject(response);
    const anyMessage: unknown = expect.any(String);

    expect(body).toMatchObject({
      type: "about:blank",
      title: "Validation Failed",
      status: 400,
      code: "VALIDATION_FAILED",
      errors: [{ field: "name", message: anyMessage }],
    });
    expect("detail" in body).toBe(false);
  });
});

describe("dialect: request id", () => {
  it("echoes a valid X-Request-Id", async () => {
    const response = await send(
      fixtureApp(),
      "https://example.com/__contract__/item",
      {
        headers: { "X-Request-Id": "contract-echo-1" },
      },
    );

    expect(response.headers.get("X-Request-Id")).toBe("contract-echo-1");
  });

  it("replaces an invalid X-Request-Id with a generated one", async () => {
    const response = await send(
      fixtureApp(),
      "https://example.com/__contract__/item",
      {
        headers: { "X-Request-Id": "not valid!" },
      },
    );

    const requestId = response.headers.get("X-Request-Id") ?? "";

    expect(requestId).not.toBe("not valid!");
    expect(requestId).toMatch(UUID);
  });

  it("generates an id when the header is absent", async () => {
    const response = await send(
      fixtureApp(),
      "https://example.com/__contract__/item",
    );

    expect(response.headers.get("X-Request-Id") ?? "").toMatch(UUID);
  });
});

describe("dialect: health surface", () => {
  it("serves liveness and readiness without the envelope", async () => {
    const app = fixtureApp();

    const health = await send(app, "https://example.com/health");

    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toContain("application/json");
    await expect(health.json()).resolves.toEqual({ status: "ok" });

    const ready = await send(app, "https://example.com/ready");

    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toEqual({ status: "ok" });
  });
});
