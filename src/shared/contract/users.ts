import { z } from "zod";

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

export type Me = z.infer<typeof meSchema>;
