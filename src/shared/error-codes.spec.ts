import { describe, expect, it } from "vitest";

import { ErrorCode } from "./error-codes";

describe("ErrorCode", () => {
  it("matches the pinned family dialect values (vocabulary enforced by contract:check)", () => {
    expect(Object.values(ErrorCode)).toEqual([
      "VALIDATION_FAILED",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "RATE_LIMITED",
      "IDEMPOTENCY_IN_PROGRESS",
      "INTERNAL",
      "AUTH_OIDC_NOT_CONFIGURED",
      "AUTH_OIDC_TOKEN_INVALID",
      "AUTH_OIDC_EMAIL_NOT_VERIFIED",
      "AUTH_OIDC_LINK_REQUIRED",
      "AUTH_OIDC_IDENTITY_ALREADY_LINKED",
      "AUTH_OIDC_PROVIDER_ALREADY_LINKED",
      "AUTH_USER_SUSPENDED",
    ]);
  });
});
