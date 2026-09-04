import { describe, expect, it } from "vitest";

import { encodeCursorV1 } from "./cursor";
import { ListQueryValidationError } from "./errors";
import { parseListQuery } from "./list-query";

const SORT_ALLOWED = {
  createdAt: { type: "datetime" },
  id: { type: "uuid" },
} as const;

const BASE_SORT = {
  allowed: SORT_ALLOWED,
  default: [{ field: "createdAt", direction: "desc" }],
  tieBreaker: { field: "id", direction: "asc" },
} as const;

const FILTERS = {
  status: { type: "enum", ops: ["eq"], enumValues: ["ACTIVE"] },
} as const;

const UUID = "11111111-1111-4111-8111-111111111111";

function encodeDefaultSortCursor(): string {
  return encodeCursorV1({
    v: 1,
    sort: "-createdAt,id",
    after: { createdAt: "2026-01-01T00:00:00.000Z", id: UUID },
  });
}

describe("parseListQuery", () => {
  it("accumulates limit and search issues on one error", () => {
    try {
      parseListQuery(
        { q: "hello", limit: "999" },
        { maxLimit: 250, sort: BASE_SORT },
      );
      throw new Error("expected parseListQuery to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ListQueryValidationError);
      if (!(error instanceof ListQueryValidationError)) {
        throw error;
      }
      expect(error.issues).toEqual([
        { field: "limit", message: "limit must be at most 250" },
        { field: "q", message: "Search is not supported" },
      ]);
    }
  });

  it("trims q when search is enabled", () => {
    const query = parseListQuery(
      { q: "  hello  " },
      { search: true, sort: BASE_SORT },
    );

    expect(query.q).toBe("hello");
  });

  it("validates the cursor against the normalized sort", () => {
    const query = parseListQuery(
      { cursor: encodeDefaultSortCursor() },
      { sort: BASE_SORT, filters: FILTERS },
    );

    expect(query.cursor?.sort).toBe("-createdAt,id");
  });
});

describe("parseListQuery rejections", () => {
  it("rejects non-numeric limit input", () => {
    expect(() =>
      parseListQuery({ limit: "nope" }, { defaultLimit: 10, sort: BASE_SORT }),
    ).toThrow(ListQueryValidationError);
  });

  it("rejects filtering when unsupported but allows an empty filter", () => {
    expect(() =>
      parseListQuery({ filter: { status: "ACTIVE" } }, { sort: BASE_SORT }),
    ).toThrow(ListQueryValidationError);

    const query = parseListQuery({ filter: {} }, { sort: BASE_SORT });

    expect(query.filters).toEqual([]);
  });

  it("rejects a cursor bound to a different sort", () => {
    expect(() =>
      parseListQuery(
        { cursor: encodeDefaultSortCursor(), sort: "id" },
        { sort: BASE_SORT, filters: FILTERS },
      ),
    ).toThrow(ListQueryValidationError);
  });
});
