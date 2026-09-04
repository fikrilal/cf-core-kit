import { describe, expect, it } from "vitest";

import {
  createCursorAfterBuilders,
  isEmptyWhereObject,
  mergeWhereClauses,
  parseCursorDateValue,
  parseCursorStringValue,
} from "./where";

type Where = Record<string, unknown>;

describe("createCursorAfterBuilders", () => {
  it("maps equality, direction-aware compares, and combiners", () => {
    const builders = createCursorAfterBuilders<"id", Where>({
      fieldOps: {
        id: {
          equals: (value) => ({ id: { equals: value } }),
          gt: (value) => ({ id: { gt: value } }),
          lt: (value) => ({ id: { lt: value } }),
        },
      },
      combiners: {
        and: (clauses) => ({ AND: clauses }),
        or: (clauses) => ({ OR: clauses }),
        empty: () => ({}),
      },
    });

    expect(builders.equals("id", "a")).toEqual({ id: { equals: "a" } });
    expect(builders.compare("id", "asc", "a")).toEqual({ id: { gt: "a" } });
    expect(builders.compare("id", "desc", "a")).toEqual({ id: { lt: "a" } });
    expect(builders.and([{ a: 1 }])).toEqual({ AND: [{ a: 1 }] });
    expect(builders.or([{ a: 1 }])).toEqual({ OR: [{ a: 1 }] });
    expect(builders.empty()).toEqual({});
  });
});

describe("mergeWhereClauses", () => {
  const empty = () => ({ EMPTY: true });
  const and = (clauses: readonly Where[]) => ({ AND: clauses });
  const isEmpty = (clause: Where) => Object.keys(clause).length === 0;

  it("returns empty when no clause is non-empty", () => {
    const clauses: Where[] = [{}, {}];

    expect(mergeWhereClauses<Where>({ clauses, empty, and, isEmpty })).toEqual({
      EMPTY: true,
    });
  });

  it("returns the single non-empty clause directly", () => {
    const clause: Where = { id: { equals: "a" } };

    expect(
      mergeWhereClauses<Where>({ clauses: [{}, clause], empty, and, isEmpty }),
    ).toBe(clause);
  });

  it("ands multiple non-empty clauses", () => {
    const clauses: Where[] = [{ a: 1 }, { b: 2 }];

    expect(mergeWhereClauses<Where>({ clauses, empty, and, isEmpty })).toEqual({
      AND: [{ a: 1 }, { b: 2 }],
    });
  });
});

describe("cursor value parsers", () => {
  it("parses strings and ISO datetimes, rejecting other shapes", () => {
    expect(parseCursorStringValue("id", "abc")).toBe("abc");
    expect(() => parseCursorStringValue("id", 5)).toThrow();
    expect(
      parseCursorDateValue("createdAt", "2026-01-01T00:00:00.000Z"),
    ).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(() => parseCursorDateValue("createdAt", "not-a-date")).toThrow();
  });

  it("detects empty where objects", () => {
    expect(isEmptyWhereObject({})).toBe(true);
    expect(isEmptyWhereObject({ a: 1 })).toBe(false);
  });
});
