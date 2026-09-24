import type { Context } from "hono";

import { ErrorCode } from "../../shared/error-codes";
import { AppError } from "../errors/app-error";
import type { AppEnv } from "../http/types";
import type { AccessTokenPrincipal } from "./access-token";

export function requirePrincipal(
  context: Context<AppEnv>,
): AccessTokenPrincipal {
  const principal = context.get("principal");
  if (principal === undefined) {
    throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
  }

  return principal;
}
