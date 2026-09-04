import { describe, expect, it } from "vitest";

import { ListQueryValidationError } from "./errors";
import { parseFilters } from "./filter";

const FILTERS = {
  status: {
    type: "enum",
    ops: ["eq", "in"],
    enumValues: ["ACTIVE", "SUSPENDED"],
  },
  createdAt: { type: "datetime", ops: ["gte", "lte"] },
  isActive: { type: "boolean", ops: ["eq"] },
} as const;

describe("parseFilters", () => {
  it("parses nested filter objects (qs-style nesting)", () => {
    const result = parseFilters(
      {
        status: { in: "ACTIVE,SUSPENDED" },
        createdAt: { gte: "2026-01-01T00:00:00.000Z" },
        isActive: "true",
      },
      FILTERS,
    );

    expect(result).toEqual([
      { field: "status", op: "in", value: ["ACTIVE", "SUSPENDED"] },
      { field: "createdAt", op: "gte", value: "2026-01-01T00:00:00.000Z" },
      { field: "isActive", op: "eq", value: true },
    ]);
  });

  it("parses in lists while ignoring empty items", () => {
    const result = parseFilters(
      { status: { in: "ACTIVE,,SUSPENDED," } },
      FILTERS,
    );

    expect(result).toEqual([
      { field: "status", op: "in", value: ["ACTIVE", "SUSPENDED"] },
    ]);
  });

  it("normalizes offset datetimes to UTC", () => {
    const result = parseFilters(
      { createdAt: { gte: "2026-01-01T00:00:00+07:00" } },
      FILTERS,
    );

    expect(result).toEqual([
      { field: "createdAt", op: "gte", value: "2025-12-31T17:00:00.000Z" },
    ]);
  });
});

describe("parseFilters rejections", () => {
  it("rejects unsupported fields", () => {
    expect(() => parseFilters({ unknown: "x" }, FILTERS)).toThrow(
      ListQueryValidationError,
    );
  });

  it("rejects invalid enum values", () => {
    expect(() => parseFilters({ status: "NOPE" }, FILTERS)).toThrow(
      ListQueryValidationError,
    );
  });

  it("rejects non-ISO datetime values", () => {
    expect(() =>
      parseFilters({ createdAt: { gte: "2026-01-01T00:00:00" } }, FILTERS),
    ).toThrow(ListQueryValidationError);
    expect(() =>
      parseFilters({ createdAt: { gte: "2026-01-01 00:00:00Z" } }, FILTERS),
    ).toThrow(ListQueryValidationError);
  });

  it("rejects filter when not an object", () => {
    expect(() => parseFilters("ACTIVE", FILTERS)).toThrow(
      ListQueryValidationError,
    );
  });

  it("rejects unsupported operators", () => {
    expect(() => parseFilters({ status: { gte: "ACTIVE" } }, FILTERS)).toThrow(
      ListQueryValidationError,
    );
  });

  it("rejects invalid values in in lists", () => {
    expect(() =>
      parseFilters({ status: { in: "ACTIVE,NOPE" } }, FILTERS),
    ).toThrow(ListQueryValidationError);
  });
});
