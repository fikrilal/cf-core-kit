import { z } from "zod";

import { cursorPaginationMetaSchema } from "./common";

export const AUTH_METHODS = ["PASSWORD", "GOOGLE"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

export const authMethodSchema = z.enum(AUTH_METHODS);

export const meProfileSchema = z
  .object({
    profileImageFileId: z.string().nullable().optional().meta({
      example: "3d2c7b2a-2dd6-46a5-8f8e-3b5de8a5b0f0",
      description:
        "Current profile image stored file ID. Use `GET /v1/me/profile-image/url` to get a short-lived URL for rendering.",
    }),
    displayName: z.string().nullable().optional().meta({ example: "Dante" }),
    givenName: z.string().nullable().optional().meta({ example: "Dante" }),
    familyName: z.string().nullable().optional().meta({ example: "Alighieri" }),
  })
  .meta({ id: "MeProfileDto" });

export const accountDeletionSchema = z
  .object({
    requestedAt: z.iso.datetime().meta({ example: "2026-01-10T12:34:56.789Z" }),
    scheduledFor: z.iso
      .datetime()
      .meta({ example: "2026-02-09T12:34:56.789Z" }),
  })
  .meta({ id: "AccountDeletionDto" });

export const meSchema = z
  .object({
    id: z.string().meta({ example: "3d2c7b2a-2dd6-46a5-8f8e-3b5de8a5b0f0" }),
    email: z.string().meta({ example: "user@example.com" }),
    emailVerified: z.boolean().meta({ example: false }),
    roles: z.array(z.string()).meta({ example: ["USER"] }),
    authMethods: z.array(authMethodSchema).meta({
      example: ["PASSWORD"],
      description: "Linked authentication methods on this account.",
    }),
    profile: meProfileSchema,
    accountDeletion: accountDeletionSchema.nullable().optional().meta({
      description:
        "When set, the account is scheduled for deletion. The request can be canceled until scheduledFor.",
    }),
  })
  .meta({ id: "MeDto" });

export const meEnvelopeSchema = z
  .object({ data: meSchema })
  .meta({ id: "MeEnvelopeDto" });

export const patchMeProfileSchema = z
  .object({
    displayName: z
      .string()
      .min(1)
      .max(100)
      .nullable()
      .optional()
      .meta({ example: "Dante" }),
    givenName: z
      .string()
      .min(1)
      .max(100)
      .nullable()
      .optional()
      .meta({ example: "Dante" }),
    familyName: z
      .string()
      .min(1)
      .max(100)
      .nullable()
      .optional()
      .meta({ example: "Alighieri" }),
  })
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.givenName !== undefined ||
      value.familyName !== undefined,
    { message: "At least one profile field must be provided" },
  )
  .meta({ id: "PatchMeProfileDto" });

export const patchMeRequestSchema = z
  .object({ profile: patchMeProfileSchema })
  .meta({ id: "PatchMeRequestDto" });

export const meSessionSchema = z
  .object({
    id: z.string().meta({ example: "3d2c7b2a-2dd6-46a5-8f8e-3b5de8a5b0f0" }),
    deviceId: z.string().nullable().optional().meta({ example: "device-a" }),
    deviceName: z.string().nullable().optional().meta({ example: "iPhone 15" }),
    ip: z.string().nullable().optional().meta({ example: "203.0.113.10" }),
    userAgent: z.string().max(512).nullable().optional().meta({
      example:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15",
    }),
    lastSeenAt: z.iso.datetime().meta({ example: "2026-01-10T12:34:56.789Z" }),
    createdAt: z.iso.datetime().meta({ example: "2026-01-10T12:34:56.789Z" }),
    expiresAt: z.iso.datetime().meta({ example: "2026-02-10T12:34:56.789Z" }),
    revokedAt: z.iso
      .datetime()
      .nullable()
      .optional()
      .meta({ example: "2026-01-10T12:34:56.789Z" }),
    current: z.boolean().meta({ example: true }),
    status: z
      .enum(["active", "revoked", "expired"])
      .meta({ example: "active" }),
  })
  .meta({ id: "MeSessionDto" });

export const meSessionsListEnvelopeSchema = z
  .object({
    data: z.array(meSessionSchema),
    meta: cursorPaginationMetaSchema,
  })
  .meta({ id: "MeSessionsListEnvelopeDto" });

export const sessionPushPlatformSchema = z.enum(["ANDROID", "IOS", "WEB"]);

export const mePushTokenUpsertRequestSchema = z
  .object({
    platform: z
      .preprocess(
        (value) =>
          typeof value === "string" ? value.trim().toUpperCase() : value,
        sessionPushPlatformSchema,
      )
      .meta({
        example: "ANDROID",
        description: "Client platform where the push token was minted.",
      }),
    token: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => value.length > 0, {
        message: "token must not be empty",
      })
      .meta({
        example: "<fcm-registration-token>",
        description: "FCM registration token for this device/app install.",
      }),
  })
  .meta({ id: "MePushTokenUpsertRequestDto" });

export type MePushTokenUpsertRequest = z.infer<
  typeof mePushTokenUpsertRequestSchema
>;

export const PROFILE_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const PROFILE_IMAGE_MAX_BYTES = 5_000_000;

const uuidSchema = z
  .string()
  .refine(
    (value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      ),
    { message: "must be a UUID" },
  );

export const createProfileImageUploadRequestSchema = z
  .object({
    contentType: z.enum(PROFILE_IMAGE_CONTENT_TYPES).meta({
      example: "image/webp",
      description:
        "Declared MIME type for the upload. Must match the Content-Type used during upload.",
    }),
    sizeBytes: z
      .preprocess(
        (value) => (typeof value === "number" ? Math.trunc(value) : value),
        z.number().min(1).max(PROFILE_IMAGE_MAX_BYTES),
      )
      .meta({
        example: 123_456,
        description:
          "Declared size of the upload in bytes (used to verify the stored object).",
      }),
  })
  .meta({ id: "CreateProfileImageUploadRequestDto" });

export const completeProfileImageUploadRequestSchema = z
  .object({
    fileId: uuidSchema.meta({
      example: "3d2c7b2a-2dd6-46a5-8f8e-3b5de8a5b0f0",
    }),
  })
  .meta({ id: "CompleteProfileImageUploadRequestDto" });

export const presignedUploadSchema = z
  .object({
    method: z.enum(["PUT"]).meta({ example: "PUT" }),
    url: z.string().meta({ example: "https://<r2-presigned-url>" }),
    headers: z.object({}).meta({
      example: { "Content-Type": "image/webp" },
      description: "Headers that must be sent with the upload request.",
    }),
  })
  .meta({ id: "PresignedUploadDto" });

export const profileImageUploadPlanSchema = z
  .object({
    fileId: z
      .string()
      .meta({ example: "3d2c7b2a-2dd6-46a5-8f8e-3b5de8a5b0f0" }),
    upload: presignedUploadSchema,
    expiresAt: z.iso.datetime().meta({ example: "2026-01-10T12:34:56.789Z" }),
  })
  .meta({ id: "ProfileImageUploadPlanDto" });

export const profileImageUploadPlanEnvelopeSchema = z
  .object({ data: profileImageUploadPlanSchema })
  .meta({ id: "ProfileImageUploadPlanEnvelopeDto" });

export const profileImageUrlSchema = z
  .object({
    url: z.string().meta({ example: "https://<r2-presigned-url>" }),
    expiresAt: z.iso.datetime().meta({ example: "2026-01-10T12:34:56.789Z" }),
  })
  .meta({ id: "ProfileImageUrlDto" });

export const profileImageUrlEnvelopeSchema = z
  .object({ data: profileImageUrlSchema })
  .meta({ id: "ProfileImageUrlEnvelopeDto" });

export type Me = z.infer<typeof meSchema>;
export type MeSession = z.infer<typeof meSessionSchema>;
export type PatchMeProfile = z.infer<typeof patchMeProfileSchema>;
export type PatchMeRequest = z.infer<typeof patchMeRequestSchema>;
