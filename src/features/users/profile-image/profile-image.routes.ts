import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { requireAuth } from "../../../platform/auth/guard";
import { idempotent } from "../../../platform/http/idempotency";
import { captureRawJson } from "../../../platform/http/raw-body";
import type { OperationMetadata } from "../../../platform/http/openapi";
import type { AppEnv } from "../../../platform/http/types";
import {
  createProfileImageUploadRequestSchema,
  completeProfileImageUploadRequestSchema,
  profileImageUploadPlanEnvelopeSchema,
  profileImageUrlEnvelopeSchema,
} from "../../../shared/contract/users";
import { ErrorCode } from "../../../shared/error-codes";
import {
  createClearProfileImageHandler,
  createCompleteProfileImageHandler,
  createProfileImageUrlHandler,
  createUploadProfileImageHandler,
  type ProfileImageRouteDependencies,
} from "./profile-image.handlers";
import { PROFILE_IMAGE_PRESIGN_TTL_SECONDS } from "./profile-image.service";

export type { ProfileImageRouteDependencies };

const IDEMPOTENCY_KEY_PARAM = z.object({
  "Idempotency-Key": z.string().min(1).max(128).optional().meta({
    description:
      "Idempotency key for safe retries of write requests. Replays return `Idempotency-Replayed: true`.",
  }),
});

export const uploadProfileImageRoute = createRoute({
  method: "post",
  path: "/v1/me/profile-image/upload",
  operationId: "users.me.profileImage.upload",
  tags: ["Users"],
  summary: "Create profile image upload plan",
  description:
    "Creates a stored-file record and returns a short-lived presigned PUT for the current user profile image.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: createProfileImageUploadRequestSchema },
      },
    },
    headers: IDEMPOTENCY_KEY_PARAM,
  },
  responses: {
    200: {
      description: "",
      content: {
        "application/json": { schema: profileImageUploadPlanEnvelopeSchema },
      },
    },
  },
  security: [{ "access-token": [] }],
});

export const completeProfileImageRoute = createRoute({
  method: "post",
  path: "/v1/me/profile-image/complete",
  operationId: "users.me.profileImage.complete",
  tags: ["Users"],
  summary: "Complete profile image upload",
  description:
    "Verifies the uploaded object against the declared metadata and attaches it as the profile image.",
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: completeProfileImageUploadRequestSchema,
        },
      },
    },
  },
  responses: {
    204: { description: "" },
  },
  security: [{ "access-token": [] }],
});

export const clearProfileImageRoute = createRoute({
  method: "delete",
  path: "/v1/me/profile-image",
  operationId: "users.me.profileImage.clear",
  tags: ["Users"],
  summary: "Clear profile image",
  description:
    "Removes the current profile image and schedules object cleanup.",
  responses: {
    204: { description: "" },
  },
  security: [{ "access-token": [] }],
});

export const profileImageUrlRoute = createRoute({
  method: "get",
  path: "/v1/me/profile-image/url",
  operationId: "users.me.profileImage.url",
  tags: ["Users"],
  summary: "Get profile image URL",
  description:
    "Returns a short-lived presigned GET URL for the current profile image, or 204 when none is set.",
  responses: {
    200: {
      description: "",
      content: {
        "application/json": { schema: profileImageUrlEnvelopeSchema },
      },
    },
    204: { description: "" },
  },
  security: [{ "access-token": [] }],
});

export const profileImageOperations: readonly OperationMetadata[] = [
  {
    method: "post",
    path: "/v1/me/profile-image/upload",
    operationId: "users.me.profileImage.upload",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.RATE_LIMITED,
      ErrorCode.IDEMPOTENCY_IN_PROGRESS,
      ErrorCode.CONFLICT,
      ErrorCode.USERS_OBJECT_STORAGE_NOT_CONFIGURED,
      ErrorCode.INTERNAL,
    ],
  },
  {
    method: "post",
    path: "/v1/me/profile-image/complete",
    operationId: "users.me.profileImage.complete",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.NOT_FOUND,
      ErrorCode.USERS_OBJECT_STORAGE_NOT_CONFIGURED,
      ErrorCode.USERS_PROFILE_IMAGE_NOT_UPLOADED,
      ErrorCode.USERS_PROFILE_IMAGE_SIZE_MISMATCH,
      ErrorCode.USERS_PROFILE_IMAGE_CONTENT_TYPE_MISMATCH,
      ErrorCode.INTERNAL,
    ],
  },
  {
    method: "delete",
    path: "/v1/me/profile-image",
    operationId: "users.me.profileImage.clear",
    errorCodes: [ErrorCode.UNAUTHORIZED, ErrorCode.INTERNAL],
  },
  {
    method: "get",
    path: "/v1/me/profile-image/url",
    operationId: "users.me.profileImage.url",
    errorCodes: [
      ErrorCode.UNAUTHORIZED,
      ErrorCode.USERS_OBJECT_STORAGE_NOT_CONFIGURED,
      ErrorCode.INTERNAL,
    ],
  },
];

export function registerProfileImageRoutes(
  app: OpenAPIHono<AppEnv>,
  dependencies: ProfileImageRouteDependencies,
): void {
  app.use("/v1/me/profile-image/upload", captureRawJson());
  app.use("/v1/me/profile-image/upload", requireAuth(dependencies.clock));
  app.use("/v1/me/profile-image/complete", requireAuth(dependencies.clock));
  app.use("/v1/me/profile-image", requireAuth(dependencies.clock));
  app.use("/v1/me/profile-image/url", requireAuth(dependencies.clock));
  app.use(
    "/v1/me/profile-image/upload",
    idempotent({
      scopeKey: "users.me.profileImage.upload",
      ttlSeconds: PROFILE_IMAGE_PRESIGN_TTL_SECONDS,
    }),
  );

  app.openapi(
    uploadProfileImageRoute,
    createUploadProfileImageHandler(dependencies),
  );
  app.openapi(
    completeProfileImageRoute,
    createCompleteProfileImageHandler(dependencies),
  );
  app.openapi(
    clearProfileImageRoute,
    createClearProfileImageHandler(dependencies),
  );
  app.openapi(profileImageUrlRoute, createProfileImageUrlHandler(dependencies));
}
