import { describe, expect, it } from "vitest";

import { normalizeRequestId } from "./request-id";

describe("normalizeRequestId", () => {
  it("accepts valid ids", () => {
    expect(normalizeRequestId("abc-123._XYZ")).toBe("abc-123._XYZ");
  });

  it("rejects empty and undefined values", () => {
    expect(normalizeRequestId("")).toBeUndefined();
    expect(normalizeRequestId(undefined)).toBeUndefined();
  });

  it("rejects ids with invalid characters", () => {
    expect(normalizeRequestId("has space")).toBeUndefined();
    expect(normalizeRequestId("semi;colon")).toBeUndefined();
  });

  it("rejects ids longer than 128 characters", () => {
    expect(normalizeRequestId("a".repeat(129))).toBeUndefined();
    expect(normalizeRequestId("a".repeat(128))).toBe("a".repeat(128));
  });
});
