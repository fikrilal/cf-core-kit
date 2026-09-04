import { describe, expect, it } from "vitest";

import { ListQueryValidationError } from "./errors";
import { parseSort } from "./sort";

const ALLOWED = {
  createdAt: { type: "datetime" },
  email: { type: "string" },
  id: { type: "uuid" },
} as const;

const OPTIONS = {
  allowed: ALLOWED,
  default: [{ field: "createdAt", direction: "desc" }],
  maxFields: 3,
  tieBreaker: { field: "id", direction: "asc" },
} as const;

describe("parseSort", () => {
  it("uses default sort and appends tie-breaker when missing", () => {
    const result = parseSort(undefined, OPTIONS);

    expect(result.sort).toEqual([
      { field: "createdAt", direction: "desc" },
      { field: "id", direction: "asc" },
    ]);
    expect(result.normalizedSort).toBe("-createdAt,id");
  });

  it("parses user sort and appends the tie-breaker", () => {
    const result = parseSort("-createdAt,email", OPTIONS);

    expect(result.sort).toEqual([
      { field: "createdAt", direction: "desc" },
      { field: "email", direction: "asc" },
      { field: "id", direction: "asc" },
    ]);
    expect(result.normalizedSort).toBe("-createdAt,email,id");
  });

  it("ignores empty tokens and trims whitespace", () => {
    const result = parseSort("  , -createdAt ,  ", OPTIONS);

    expect(result.sort).toEqual([
      { field: "createdAt", direction: "desc" },
      { field: "id", direction: "asc" },
    ]);
  });
});

describe("parseSort rejections", () => {
  it("rejects unsupported sort fields", () => {
    expect(() => parseSort("unknown", OPTIONS)).toThrow(
      ListQueryValidationError,
    );
  });

  it("rejects more than max sort fields", () => {
    expect(() =>
      parseSort("createdAt,email,id", { ...OPTIONS, maxFields: 2 }),
    ).toThrow(ListQueryValidationError);
  });

  it("rejects duplicate sort fields", () => {
    expect(() => parseSort("createdAt,-createdAt", OPTIONS)).toThrow(
      ListQueryValidationError,
    );
  });

  it("rejects non-string sort inputs", () => {
    expect(() => parseSort(["createdAt"], OPTIONS)).toThrow(
      ListQueryValidationError,
    );
  });
});
