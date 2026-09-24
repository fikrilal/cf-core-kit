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
      "AUTH_EMAIL_VERIFICATION_TOKEN_INVALID",
      "AUTH_EMAIL_VERIFICATION_TOKEN_EXPIRED",
      "AUTH_PUSH_NOT_CONFIGURED",
      "USERS_OBJECT_STORAGE_NOT_CONFIGURED",
      "USERS_PROFILE_IMAGE_NOT_UPLOADED",
      "USERS_PROFILE_IMAGE_SIZE_MISMATCH",
      "USERS_PROFILE_IMAGE_CONTENT_TYPE_MISMATCH",
      "USERS_CANNOT_DELETE_LAST_ADMIN",
      "AUTH_REFRESH_TOKEN_INVALID",
      "AUTH_REFRESH_TOKEN_EXPIRED",
      "AUTH_REFRESH_TOKEN_REUSED",
      "AUTH_SESSION_REVOKED",
      "AUTH_USER_SUSPENDED",
    ]);
  });
});
