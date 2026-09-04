import { describe, expect, it } from "vitest";

import { decodeCursorV1, encodeCursorV1 } from "./cursor";
import { ListQueryValidationError } from "./errors";

const SORT_ALLOWED = {
  createdAt: { type: "datetime" },
  id: { type: "uuid" },
} as const;

const UUID = "11111111-1111-4111-8111-111111111111";

const DECODE_OPTIONS = {
  expectedSort: "-createdAt,id",
  sortFields: ["createdAt", "id"],
  allowed: SORT_ALLOWED,
} as const;

function toBase64Url(input: string): string {
  return btoa(input)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

describe("cursor v1 codec", () => {
  it("round-trips and validates required fields", () => {
    const payload = {
      v: 1 as const,
      sort: "-createdAt,id",
      after: { createdAt: "2026-01-01T00:00:00.000Z", id: UUID },
    };

    const decoded = decodeCursorV1(encodeCursorV1(payload), DECODE_OPTIONS);

    expect(decoded.v).toBe(1);
    expect(decoded.sort).toBe("-createdAt,id");
    expect(decoded.after.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(decoded.after.id).toBe(UUID);
  });

  it("rejects a sort mismatch", () => {
    const encoded = encodeCursorV1({
      v: 1 as const,
      sort: "-createdAt,id",
      after: { createdAt: "2026-01-01T00:00:00.000Z", id: UUID },
    });

    expect(() =>
      decodeCursorV1(encoded, {
        ...DECODE_OPTIONS,
        expectedSort: "createdAt,id",
      }),
    ).toThrow(ListQueryValidationError);
  });

  it("rejects missing required after fields", () => {
    const encoded = encodeCursorV1({
      v: 1 as const,
      sort: "-createdAt,id",
      after: { createdAt: "2026-01-01T00:00:00.000Z" },
    });

    expect(() => decodeCursorV1(encoded, DECODE_OPTIONS)).toThrow(
      ListQueryValidationError,
    );
  });
});

describe("cursor v1 codec rejections", () => {
  it("rejects invalid encoding and invalid JSON", () => {
    expect(() => decodeCursorV1("%%%not-base64%%%", DECODE_OPTIONS)).toThrow(
      ListQueryValidationError,
    );

    expect(() =>
      decodeCursorV1(toBase64Url("not-json"), DECODE_OPTIONS),
    ).toThrow(ListQueryValidationError);
  });

  it("rejects overly long cursors", () => {
    expect(() => decodeCursorV1("a".repeat(5000), DECODE_OPTIONS)).toThrow(
      ListQueryValidationError,
    );
  });

  it("rejects unsupported fields and invalid field values in after", () => {
    const encoded = encodeCursorV1({
      v: 1 as const,
      sort: "-createdAt,id",
      after: {
        createdAt: "2026-01-01T00:00:00.000Z",
        id: "not-a-uuid",
        unknown: "x",
      },
    });

    expect(() => decodeCursorV1(encoded, DECODE_OPTIONS)).toThrow(
      ListQueryValidationError,
    );
  });

  it("rejects non-ISO datetime values in after", () => {
    const encoded = encodeCursorV1({
      v: 1 as const,
      sort: "-createdAt,id",
      after: { createdAt: "2026-01-01T00:00:00", id: UUID },
    });

    expect(() => decodeCursorV1(encoded, DECODE_OPTIONS)).toThrow(
      ListQueryValidationError,
    );
  });
});
