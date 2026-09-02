import { describe, expect, it } from "vitest";

import { ErrorCode } from "./error-codes";

describe("ErrorCode", () => {
  it("matches the family dialect values", () => {
    expect(Object.values(ErrorCode)).toEqual([
      "VALIDATION_FAILED",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "RATE_LIMITED",
      "IDEMPOTENCY_IN_PROGRESS",
      "INTERNAL",
    ]);
  });
});
