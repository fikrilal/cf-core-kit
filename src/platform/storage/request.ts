import type { Context } from "hono";

import { ErrorCode } from "../../shared/error-codes";
import { systemClock } from "../clock/clock";
import { configFrom } from "../config/request";
import { AppError } from "../errors/app-error";
import type { AppEnv } from "../http/types";
import { createObjectPresigner, type ObjectPresigner } from "./presign";

export function presignerFrom(context: Context<AppEnv>): ObjectPresigner {
  const config = configFrom(context);
  const { r2AccountId, r2Bucket, r2AccessKeyId, r2SecretAccessKey } = config;

  if (
    r2AccountId === undefined ||
    r2Bucket === undefined ||
    r2AccessKeyId === undefined ||
    r2SecretAccessKey === undefined
  ) {
    throw new AppError({
      status: 500,
      code: ErrorCode.INTERNAL,
      message: "R2 is not configured",
    });
  }

  return createObjectPresigner(
    {
      accountId: r2AccountId,
      bucket: r2Bucket,
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
    },
    systemClock,
  );
}
