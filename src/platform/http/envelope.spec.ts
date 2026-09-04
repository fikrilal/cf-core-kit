import { describe, expect, it } from "vitest";

import { created, data, list, noContent } from "./envelope";

describe("data", () => {
  it("wraps a payload in the envelope", async () => {
    const response = data({ id: "1" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { id: "1" } });
  });
});

describe("list", () => {
  it("renders data plus list meta", async () => {
    const response = list({ items: [{ id: "1" }], limit: 20, hasMore: false });

    await expect(response.json()).resolves.toEqual({
      data: [{ id: "1" }],
      meta: { limit: 20, hasMore: false },
    });
  });

  it("includes nextCursor when present", async () => {
    const response = list({
      items: [],
      limit: 10,
      hasMore: true,
      nextCursor: "abc",
    });

    await expect(response.json()).resolves.toEqual({
      data: [],
      meta: { nextCursor: "abc", limit: 10, hasMore: true },
    });
  });
});

describe("created", () => {
  it("returns 201 with Location when provided", async () => {
    const response = created({ id: "1" }, "/resources/1");

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe("/resources/1");
    await expect(response.json()).resolves.toEqual({ data: { id: "1" } });
  });

  it("returns 201 without Location when omitted", () => {
    const response = created({ id: "1" });

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBeNull();
  });
});

describe("noContent", () => {
  it("returns an empty 204", async () => {
    const response = noContent();

    expect(response.status).toBe(204);
    await expect(response.text()).resolves.toBe("");
  });
});
