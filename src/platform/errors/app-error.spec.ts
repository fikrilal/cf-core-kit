import { describe, expect, it } from "vitest";

import { ErrorCode } from "../../shared/error-codes";
import { AppError } from "./app-error";

describe("AppError", () => {
  it("carries status, code, and message", () => {
    const error = new AppError({
      status: 404,
      code: ErrorCode.NOT_FOUND,
      message: "Resource not found",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("AppError");
    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Resource not found");
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it("carries retryAfterSeconds for retryable failures", () => {
    const error = new AppError({
      status: 429,
      code: ErrorCode.RATE_LIMITED,
      message: "Too many requests",
      retryAfterSeconds: 5,
    });

    expect(error.retryAfterSeconds).toBe(5);
  });

  it("carries issues and defaults the message to empty", () => {
    const error = new AppError({
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
      issues: [{ field: "email", message: "Required" }],
    });

    expect(error.message).toBe("");
    expect(error.issues).toEqual([{ field: "email", message: "Required" }]);
  });
});
