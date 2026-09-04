import { describe, expect, it } from "vitest";

import {
  buildCursorAfterWhere,
  type CursorAfterBuilders,
} from "./cursor-after";

type SortField = "createdAt" | "id";
type Where = Record<string, unknown>;

const SORT_DESC_ID_ASC = [
  { field: "createdAt", direction: "desc" },
  { field: "id", direction: "asc" },
] as const;

function expectString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Expected string cursor value");
  }

  return value;
}

function createBuilders(): CursorAfterBuilders<SortField, Where> {
  return {
    equals: (field, value) =>
      field === "createdAt"
        ? { createdAt: { equals: new Date(expectString(value)) } }
        : { id: { equals: String(value) } },
    compare: (field, direction, value) => {
      if (field === "createdAt") {
        const date = new Date(expectString(value));
        return direction === "asc"
          ? { createdAt: { gt: date } }
          : { createdAt: { lt: date } };
      }

      return direction === "asc"
        ? { id: { gt: String(value) } }
        : { id: { lt: String(value) } };
    },
    and: (clauses) => ({ AND: clauses }),
    or: (clauses) => ({ OR: clauses }),
    empty: () => ({}),
  };
}

describe("buildCursorAfterWhere", () => {
  it("builds a lexicographic after-where with equality prefix", () => {
    const where = buildCursorAfterWhere<SortField, Where>({
      sort: SORT_DESC_ID_ASC,
      after: { createdAt: "2026-02-26T00:00:00.000Z", id: "user_2" },
      builders: createBuilders(),
    });

    expect(where).toEqual({
      OR: [
        { AND: [{ createdAt: { lt: new Date("2026-02-26T00:00:00.000Z") } }] },
        {
          AND: [
            { createdAt: { equals: new Date("2026-02-26T00:00:00.000Z") } },
            { id: { gt: "user_2" } },
          ],
        },
      ],
    });
  });

  it("builds where with descending tie-breaker", () => {
    const where = buildCursorAfterWhere<SortField, Where>({
      sort: [
        { field: "createdAt", direction: "desc" },
        { field: "id", direction: "desc" },
      ],
      after: { createdAt: "2026-02-26T01:00:00.000Z", id: "audit_9" },
      builders: createBuilders(),
    });

    expect(where).toEqual({
      OR: [
        { AND: [{ createdAt: { lt: new Date("2026-02-26T01:00:00.000Z") } }] },
        {
          AND: [
            { createdAt: { equals: new Date("2026-02-26T01:00:00.000Z") } },
            { id: { lt: "audit_9" } },
          ],
        },
      ],
    });
  });

  it("builds where with ascending sorts", () => {
    const where = buildCursorAfterWhere<SortField, Where>({
      sort: [
        { field: "createdAt", direction: "asc" },
        { field: "id", direction: "asc" },
      ],
      after: { createdAt: "2026-02-26T02:00:00.000Z", id: "session_3" },
      builders: createBuilders(),
    });

    expect(where).toEqual({
      OR: [
        { AND: [{ createdAt: { gt: new Date("2026-02-26T02:00:00.000Z") } }] },
        {
          AND: [
            { createdAt: { equals: new Date("2026-02-26T02:00:00.000Z") } },
            { id: { gt: "session_3" } },
          ],
        },
      ],
    });
  });

  it("returns the empty where for an empty sort", () => {
    const where = buildCursorAfterWhere<SortField, Where>({
      sort: [],
      after: {},
      builders: createBuilders(),
    });

    expect(where).toEqual({});
  });

  it("throws when a cursor value is missing for a sort field", () => {
    expect(() =>
      buildCursorAfterWhere<SortField, Where>({
        sort: SORT_DESC_ID_ASC,
        after: { createdAt: "2026-02-26T03:00:00.000Z" },
        builders: createBuilders(),
      }),
    ).toThrow('Cursor missing value for sort field "id"');
  });
});
