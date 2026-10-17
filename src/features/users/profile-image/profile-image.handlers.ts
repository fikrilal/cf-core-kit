import { type RouteHandler } from "@hono/zod-openapi";

import type { Clock } from "../../../platform/clock/clock";
import { configFrom } from "../../../platform/config/request";
import { databaseFrom } from "../../../platform/db/request";
import { dataPayload, noContent } from "../../../platform/http/envelope";
import { logRequestError } from "../../../platform/http/request-logging";
import type { AppEnv } from "../../../platform/http/types";
import { rawJsonOf } from "../../../platform/http/raw-body";
import { rejectUnknownKeys } from "../../../platform/http/validation";
import { createLogger } from "../../../platform/logging/logger";
import { queueFrom } from "../../../platform/queue/request";
import type { LimiterFactory } from "../../../platform/rate-limit/require-rate-limit";
import { objectStorageFrom } from "../../../platform/storage/request";
import { requirePrincipal } from "../../../platform/auth/principal";
import { assertAllowedOrFailOpen } from "../../../platform/rate-limit/enforce";
import { AppError } from "../../../platform/errors/app-error";
import { requireLiveUser } from "../shared/guards";
import type {
  clearProfileImageRoute,
  completeProfileImageRoute,
  profileImageUrlRoute,
  uploadProfileImageRoute,
} from "./profile-image.routes";
import { ErrorCode } from "../../../shared/error-codes";
import { createProfileImageCleanupProducer } from "./profile-image.jobs";
import {
  clearProfileImage,
  getCurrentProfileImageFile,
} from "./profile-image.repository";
import {
  completeUpload,
  createUploadPlan,
  PROFILE_IMAGE_GET_URL_TTL_SECONDS,
} from "./profile-image.service";

const PROFILE_IMAGE_UPLOAD_USER_POLICY = {
  limit: 20,
  windowSeconds: 3_600,
  blockSeconds: 900,
} as const;

const PROFILE_IMAGE_UPLOAD_IP_POLICY = {
  limit: 60,
  windowSeconds: 300,
  blockSeconds: 900,
} as const;

export type ProfileImageRouteDependencies = Readonly<{
  clock: Clock;
  limiterFactory: LimiterFactory;
  queue?: Queue;
}>;

export function createUploadProfileImageHandler(
  dependencies: ProfileImageRouteDependencies,
): RouteHandler<typeof uploadProfileImageRoute, AppEnv> {
  return async (context) => {
    const principal = requirePrincipal(context);
    const body = context.req.valid("json");
    rejectUnknownKeys(rawJsonOf(context), ["contentType", "sizeBytes"]);
    await requireLiveUser(context, principal.userId);

    const limiter = dependencies.limiterFactory(context);
    const ip = context.req.header("CF-Connecting-IP");
    await assertAllowedOrFailOpen(context, limiter, {
      key: `users.profile-image.upload:user:${principal.userId}`,
      ...PROFILE_IMAGE_UPLOAD_USER_POLICY,
    });
    if (ip !== undefined) {
      await assertAllowedOrFailOpen(context, limiter, {
        key: `users.profile-image.upload:ip:${ip}`,
        ...PROFILE_IMAGE_UPLOAD_IP_POLICY,
      });
    }

    const handle = objectStorageFrom(context);
    const planned = await createUploadPlan(
      {
        db: databaseFrom(context),
        clock: dependencies.clock,
        storage: handle,
        logger: createLogger(configFrom(context)),
      },
      {
        userId: principal.userId,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        traceId: context.get("requestId"),
      },
    );

    switch (planned.kind) {
      case "not_found":
        throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
      case "ok":
        break;
      default: {
        const unreachable: never = planned;
        throw new Error(
          `Unexpected upload plan outcome: ${String(unreachable)}`,
        );
      }
    }

    const plan = planned.plan;

    const config = configFrom(context);
    const cleanup = createProfileImageCleanupProducer({
      queue: dependencies.queue ?? queueFrom(context),
      clock: dependencies.clock,
      logger: createLogger(config),
    });
    const enqueued = await cleanup.enqueueExpireUpload({
      userId: principal.userId,
      fileId: plan.fileId,
      expiresAt: plan.expiresAt,
    });

    if (!enqueued) {
      logRequestError(
        context,
        new Error(`expiry job enqueue rejected for file ${plan.fileId}`),
      );
    }

    return context.json(dataPayload(plan), 200);
  };
}

export function createCompleteProfileImageHandler(
  dependencies: ProfileImageRouteDependencies,
): RouteHandler<typeof completeProfileImageRoute, AppEnv> {
  return async (context) => {
    const principal = requirePrincipal(context);
    const body = context.req.valid("json");
    rejectUnknownKeys(rawJsonOf(context), ["fileId"]);
    await requireLiveUser(context, principal.userId);

    const handle = objectStorageFrom(context);
    const result = await completeUpload(
      {
        db: databaseFrom(context),
        clock: dependencies.clock,
        storage: handle,
        logger: createLogger(configFrom(context)),
      },
      { userId: principal.userId, fileId: body.fileId },
    );

    switch (result.kind) {
      case "noop":
        return noContent();
      case "attached":
        if (result.previousFileId !== null) {
          const cleanup = createProfileImageCleanupProducer({
            queue: dependencies.queue ?? queueFrom(context),
            clock: dependencies.clock,
            logger: createLogger(configFrom(context)),
          });
          await cleanup.enqueueDeleteStoredFile({
            userId: principal.userId,
            fileId: result.previousFileId,
          });
        }
        return noContent();
      case "not_found":
        throw new AppError({ status: 404, code: ErrorCode.NOT_FOUND });
      case "not_uploaded":
        throw new AppError({
          status: 409,
          code: ErrorCode.USERS_PROFILE_IMAGE_NOT_UPLOADED,
          message: "Upload is not available",
        });
      case "size_mismatch":
        throw new AppError({
          status: 409,
          code: ErrorCode.USERS_PROFILE_IMAGE_SIZE_MISMATCH,
        });
      case "content_type_mismatch":
        throw new AppError({
          status: 409,
          code: ErrorCode.USERS_PROFILE_IMAGE_CONTENT_TYPE_MISMATCH,
        });
      default: {
        const unreachable: never = result;
        throw new Error(
          `Unexpected profile image outcome: ${String(unreachable)}`,
        );
      }
    }
  };
}

export function createClearProfileImageHandler(
  dependencies: ProfileImageRouteDependencies,
): RouteHandler<typeof clearProfileImageRoute, AppEnv> {
  return async (context) => {
    const principal = requirePrincipal(context);
    await requireLiveUser(context, principal.userId);

    const cleared = await clearProfileImage(databaseFrom(context), {
      userId: principal.userId,
      now: dependencies.clock.now(),
    });

    if (cleared.clearedFileId !== null) {
      const cleanup = createProfileImageCleanupProducer({
        queue: dependencies.queue ?? queueFrom(context),
        clock: dependencies.clock,
        logger: createLogger(configFrom(context)),
      });
      await cleanup.enqueueDeleteStoredFile({
        userId: principal.userId,
        fileId: cleared.clearedFileId,
      });
    }

    return noContent();
  };
}

export function createProfileImageUrlHandler(
  dependencies: ProfileImageRouteDependencies,
): RouteHandler<typeof profileImageUrlRoute, AppEnv> {
  return async (context) => {
    const principal = requirePrincipal(context);
    await requireLiveUser(context, principal.userId);

    const file = await getCurrentProfileImageFile(
      databaseFrom(context),
      principal.userId,
    );

    if (file === undefined) return noContent();

    const handle = objectStorageFrom(context);
    const url = await handle.storage.presign({
      method: "GET",
      key: file.objectKey,
      expiresInSeconds: PROFILE_IMAGE_GET_URL_TTL_SECONDS,
    });
    const expiresAt = new Date(
      dependencies.clock.now().getTime() +
        PROFILE_IMAGE_GET_URL_TTL_SECONDS * 1000,
    ).toISOString();

    return context.json(dataPayload({ url, expiresAt }), 200);
  };
}
