import { describe, expect, it } from "vitest";

import {
  computeRequestHash,
  createCompletedRecord,
  createInProgressRecord,
  hashScopeKey,
  isWriteMethod,
  parseRecord,
} from "./idempotency.core";

describe("hashScopeKey", () => {
  it("is deterministic and url-safe", async () => {
    const hash = await hashScopeKey("items.create");

    expect(hash).toBe(await hashScopeKey("items.create"));
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hash).not.toBe(await hashScopeKey("items.update"));
  });
});

describe("computeRequestHash", () => {
  it("is stable across key order and distinguishes payloads", async () => {
    const first = await computeRequestHash({
      method: "POST",
      path: "/items",
      query: { a: "1", b: "2" },
      body: { label: "x", count: 2 },
    });
    const reordered = await computeRequestHash({
      method: "POST",
      path: "/items",
      query: { b: "2", a: "1" },
      body: { count: 2, label: "x" },
    });
    const different = await computeRequestHash({
      method: "POST",
      path: "/items",
      query: { a: "1", b: "2" },
      body: { label: "y", count: 2 },
    });

    expect(reordered).toBe(first);
    expect(different).not.toBe(first);
  });
});

describe("isWriteMethod", () => {
  it("recognizes write methods only", () => {
    expect(isWriteMethod("POST")).toBe(true);
    expect(isWriteMethod("PUT")).toBe(true);
    expect(isWriteMethod("PATCH")).toBe(true);
    expect(isWriteMethod("DELETE")).toBe(true);
    expect(isWriteMethod("GET")).toBe(false);
    expect(isWriteMethod(undefined)).toBe(false);
  });
});

describe("parseRecord", () => {
  it("round-trips in-progress and completed records", () => {
    const inProgress = createInProgressRecord("hash-1", 100);

    expect(parseRecord(JSON.stringify(inProgress))).toEqual(inProgress);

    const completed = createCompletedRecord({
      requestHash: "hash-1",
      status: 201,
      body: { id: "1" },
      headers: { Location: "/items/1" },
      completedAt: 200,
    });

    expect(parseRecord(JSON.stringify(completed))).toEqual(completed);
  });

  it("rejects malformed records", () => {
    expect(parseRecord("not-json")).toBeUndefined();
    expect(
      parseRecord(JSON.stringify({ v: 2, state: "in_progress" })),
    ).toBeUndefined();
    expect(
      parseRecord(JSON.stringify({ v: 1, state: "in_progress" })),
    ).toBeUndefined();
    expect(
      parseRecord(JSON.stringify({ v: 1, state: "completed" })),
    ).toBeUndefined();
  });
});

describe("createCompletedRecord", () => {
  it("omits the body and headers for empty responses", () => {
    const record = createCompletedRecord({
      requestHash: "hash-1",
      status: 204,
      body: undefined,
      headers: {},
      completedAt: 1,
    });

    expect(record.hasBody).toBe(false);
    expect(record).not.toHaveProperty("body");
    expect(record).not.toHaveProperty("headers");
  });
});
