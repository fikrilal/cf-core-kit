import { AppError } from "../../../platform/errors/app-error";
import { ErrorCode } from "../../../shared/error-codes";

export function oidcNotConfigured(): AppError {
  return new AppError({
    status: 500,
    code: ErrorCode.AUTH_OIDC_NOT_CONFIGURED,
    message: "OIDC is not configured",
  });
}

export function oidcTokenInvalid(): AppError {
  return new AppError({
    status: 401,
    code: ErrorCode.AUTH_OIDC_TOKEN_INVALID,
    message: "Invalid OIDC token",
  });
}

export function oidcEmailNotVerified(): AppError {
  return new AppError({
    status: 400,
    code: ErrorCode.AUTH_OIDC_EMAIL_NOT_VERIFIED,
    message: "Email is not verified",
  });
}

export function oidcLinkRequired(): AppError {
  return new AppError({
    status: 409,
    code: ErrorCode.AUTH_OIDC_LINK_REQUIRED,
    message: "Sign in with an existing method to link this provider",
  });
}

export function oidcIdentityAlreadyLinked(): AppError {
  return new AppError({
    status: 409,
    code: ErrorCode.AUTH_OIDC_IDENTITY_ALREADY_LINKED,
    message: "This identity is linked to another account",
  });
}

export function oidcProviderAlreadyLinked(): AppError {
  return new AppError({
    status: 409,
    code: ErrorCode.AUTH_OIDC_PROVIDER_ALREADY_LINKED,
    message: "This provider is already linked to the account",
  });
}

export function userSuspended(): AppError {
  return new AppError({
    status: 403,
    code: ErrorCode.AUTH_USER_SUSPENDED,
    message: "User is suspended",
  });
}

export function refreshTokenInvalid(): AppError {
  return new AppError({
    status: 401,
    code: ErrorCode.AUTH_REFRESH_TOKEN_INVALID,
    message: "Invalid refresh token",
  });
}

export function refreshTokenExpired(): AppError {
  return new AppError({
    status: 401,
    code: ErrorCode.AUTH_REFRESH_TOKEN_EXPIRED,
    message: "Refresh token has expired",
  });
}

export function refreshTokenReused(): AppError {
  return new AppError({
    status: 401,
    code: ErrorCode.AUTH_REFRESH_TOKEN_REUSED,
    message: "Refresh token has already been used",
  });
}

export function sessionRevoked(): AppError {
  return new AppError({
    status: 401,
    code: ErrorCode.AUTH_SESSION_REVOKED,
    message: "Session has been revoked",
  });
}

export function emailVerificationTokenInvalid(): AppError {
  return new AppError({
    status: 400,
    code: ErrorCode.AUTH_EMAIL_VERIFICATION_TOKEN_INVALID,
    message: "Email verification token is invalid",
  });
}

export function emailVerificationTokenExpired(): AppError {
  return new AppError({
    status: 400,
    code: ErrorCode.AUTH_EMAIL_VERIFICATION_TOKEN_EXPIRED,
    message: "Email verification token expired",
  });
}

export function internalError(): AppError {
  return new AppError({
    status: 500,
    code: ErrorCode.INTERNAL,
  });
}
