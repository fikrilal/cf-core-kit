import { describe, expect, it } from "vitest";

import { send } from "../../../test/app-request";

import { encodeCursorV1 } from "../../shared/list-query";
import { createApp } from "./app";
import { data } from "./envelope";
import { readListQuery } from "./list-query";

const SORT = {
  allowed: { createdAt: { type: "datetime" }, id: { type: "uuid" } },
  default: [{ field: "createdAt", direction: "desc" }],
  tieBreaker: { field: "id", direction: "asc" },
} as const;

const FILTERS = {
  status: {
    type: "enum",
    ops: ["eq", "in"],
    enumValues: ["ACTIVE", "SUSPENDED"],
  },
  createdAt: { type: "datetime", ops: ["gte", "lte"] },
} as const;

const UUID = "11111111-1111-4111-8111-111111111111";

function createListApp() {
  const app = createApp();

  app.get("/items", (context) =>
    data(
      readListQuery(context, {
        sort: SORT,
        filters: FILTERS,
        defaultLimit: 10,
        maxLimit: 100,
      }),
    ),
  );

  return app;
}

describe("readListQuery", () => {
  it("applies defaults when no query params are present", async () => {
    const response = await send(createListApp(), "https://example.com/items");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        limit: 10,
        sort: [
          { field: "createdAt", direction: "desc" },
          { field: "id", direction: "asc" },
        ],
        normalizedSort: "-createdAt,id",
        filters: [],
      },
    });
  });

  it("parses sort, limit, and bracket filters", async () => {
    const response = await send(
      createListApp(),
      "https://example.com/items?limit=5&sort=createdAt&filter[status][in]=ACTIVE,SUSPENDED&filter[createdAt][gte]=2026-01-01T00:00:00.000Z",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        limit: 5,
        sort: [
          { field: "createdAt", direction: "asc" },
          { field: "id", direction: "asc" },
        ],
        normalizedSort: "createdAt,id",
        filters: [
          { field: "status", op: "in", value: ["ACTIVE", "SUSPENDED"] },
          { field: "createdAt", op: "gte", value: "2026-01-01T00:00:00.000Z" },
        ],
      },
    });
  });

  it("round-trips a cursor bound to the normalized sort", async () => {
    const cursor = encodeCursorV1({
      v: 1,
      sort: "-createdAt,id",
      after: { createdAt: "2026-01-01T00:00:00.000Z", id: UUID },
    });

    const response = await send(
      createListApp(),
      `https://example.com/items?cursor=${encodeURIComponent(cursor)}`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { cursor: { v: 1, sort: "-createdAt,id" } },
    });
  });
});

describe("readListQuery validation", () => {
  it("rejects an unsupported filter field with a field-scoped issue", async () => {
    const response = await send(
      createListApp(),
      "https://example.com/items?filter[unknown]=x",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: 400,
      code: "VALIDATION_FAILED",
      title: "Validation Failed",
      errors: [
        { field: "filter[unknown]", message: "Unsupported filter field" },
      ],
    });
  });

  it("rejects limits beyond the endpoint maximum", async () => {
    const response = await send(
      createListApp(),
      "https://example.com/items?limit=999",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: 400,
      code: "VALIDATION_FAILED",
      errors: [{ field: "limit", message: "limit must be at most 100" }],
    });
  });

  it("rejects unsupported sort fields", async () => {
    const response = await send(
      createListApp(),
      "https://example.com/items?sort=-email",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [{ field: "sort", message: 'Unsupported sort field "email"' }],
    });
  });
});

describe("readListQuery bounds and strictness", () => {
  it("allows an endpoint maxLimit above the 250 default", async () => {
    const app = createApp();

    app.get("/wide", (context) =>
      data(
        readListQuery(context, { sort: SORT, defaultLimit: 25, maxLimit: 500 }),
      ),
    );

    const response = await send(app, "https://example.com/wide?limit=300");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { limit: 300 },
    });
  });

  it("rejects unknown query parameters", async () => {
    const response = await send(
      createListApp(),
      "https://example.com/items?page=2",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: 400,
      code: "VALIDATION_FAILED",
      errors: [{ field: "page", message: "Unsupported query parameter" }],
    });
  });

  it("rejects malformed filter keys as unknown parameters", async () => {
    const response = await send(
      createListApp(),
      "https://example.com/items?filter[status=x",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [
        { field: "filter[status", message: "Unsupported query parameter" },
      ],
    });
  });

  it("rejects a non-object filter value", async () => {
    const response = await send(
      createListApp(),
      "https://example.com/items?filter=status",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      errors: [{ field: "filter", message: "filter must be an object" }],
    });
  });
});
