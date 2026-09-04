import { describe, expect, it } from "vitest";

import { ErrorCode } from "../../shared/error-codes";
import { AppError } from "../errors/app-error";
import {
  notFoundResponse,
  problemResponse,
  resolveProblemTitle,
  statusTitle,
} from "./problem";

describe("statusTitle", () => {
  it("maps known statuses", () => {
    expect(statusTitle(404)).toBe("Not Found");
    expect(statusTitle(429)).toBe("Too Many Requests");
    expect(statusTitle(503)).toBe("Service Unavailable");
  });

  it("falls back for unknown statuses", () => {
    expect(statusTitle(418)).toBe("Error");
    expect(statusTitle(599)).toBe("Internal Server Error");
  });
});

describe("resolveProblemTitle", () => {
  it("special-cases validation failures", () => {
    expect(
      resolveProblemTitle({ status: 400, code: ErrorCode.VALIDATION_FAILED }),
    ).toBe("Validation Failed");
  });

  it("uses the status title otherwise", () => {
    expect(resolveProblemTitle({ status: 409, code: ErrorCode.CONFLICT })).toBe(
      "Conflict",
    );
  });
});

describe("problemResponse", () => {
  it("renders an AppError as a problem", async () => {
    const response = problemResponse(
      new AppError({
        status: 404,
        code: ErrorCode.NOT_FOUND,
        message: "Resource not found",
      }),
      "req-1",
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe(
      "application/problem+json",
    );
    expect(response.headers.get("X-Request-Id")).toBe("req-1");
    await expect(response.json()).resolves.toEqual({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "Resource not found",
      code: "NOT_FOUND",
      traceId: "req-1",
    });
  });

  it("omits traceId when no request id is available", async () => {
    const response = problemResponse(
      new AppError({
        status: 400,
        code: ErrorCode.VALIDATION_FAILED,
        message: "Invalid input",
      }),
      undefined,
    );

    expect(response.headers.get("X-Request-Id")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      type: "about:blank",
      title: "Validation Failed",
      status: 400,
      detail: "Invalid input",
      code: "VALIDATION_FAILED",
    });
  });

  it("renders issues as errors[] without detail", async () => {
    const response = problemResponse(
      new AppError({
        status: 400,
        code: ErrorCode.VALIDATION_FAILED,
        issues: [
          { field: "email", message: "Required" },
          { message: "Invalid" },
        ],
      }),
      undefined,
    );

    await expect(response.json()).resolves.toEqual({
      type: "about:blank",
      title: "Validation Failed",
      status: 400,
      code: "VALIDATION_FAILED",
      errors: [{ field: "email", message: "Required" }, { message: "Invalid" }],
    });
  });
});

describe("problemResponse retry and fallback", () => {
  it("sets Retry-After from retryAfterSeconds", () => {
    const response = problemResponse(
      new AppError({
        status: 429,
        code: ErrorCode.RATE_LIMITED,
        message: "Slow down",
        retryAfterSeconds: 7,
      }),
      undefined,
    );

    expect(response.headers.get("Retry-After")).toBe("7");
  });

  it("renders unknown errors as a generic internal problem without detail", async () => {
    const response = problemResponse(new Error("secret detail"), "req-2");

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Request-Id")).toBe("req-2");
    await expect(response.json()).resolves.toEqual({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
      code: "INTERNAL",
      traceId: "req-2",
    });
  });
});

describe("notFoundResponse", () => {
  it("renders the 404 fallback", async () => {
    const response = notFoundResponse("req-3");

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      code: "NOT_FOUND",
      traceId: "req-3",
    });
  });
});
