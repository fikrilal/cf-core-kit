import type { Context } from "hono";

import { ErrorCode } from "../../shared/error-codes";
import type { AppConfig } from "../config/config";
import { systemClock } from "../clock/clock";
import { configFrom } from "../config/request";
import { AppError } from "../errors/app-error";
import type { AppEnv } from "../http/types";
import { createObjectStorage, type ObjectStorageHandle } from "./presign";

export function objectStorageFromConfig(
  config: AppConfig,
): ObjectStorageHandle | undefined {
  const { r2AccountId, r2Bucket, r2AccessKeyId, r2SecretAccessKey } = config;

  if (
    r2AccountId === undefined ||
    r2Bucket === undefined ||
    r2AccessKeyId === undefined ||
    r2SecretAccessKey === undefined
  ) {
    return undefined;
  }

  return {
    bucket: r2Bucket,
    storage: createObjectStorage(
      {
        accountId: r2AccountId,
        bucket: r2Bucket,
        accessKeyId: r2AccessKeyId,
        secretAccessKey: r2SecretAccessKey,
      },
      systemClock,
    ),
  };
}

export function objectStorageFrom(
  context: Context<AppEnv>,
): ObjectStorageHandle {
  const handle = objectStorageFromConfig(configFrom(context));

  if (handle === undefined) {
    throw new AppError({
      status: 501,
      code: ErrorCode.USERS_OBJECT_STORAGE_NOT_CONFIGURED,
      message: "Object storage is not configured",
    });
  }

  return handle;
}
