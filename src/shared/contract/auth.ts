import { z } from "zod";

import { authMethodSchema, meSchema } from "./users";

export const oidcProviderSchema = z.enum(["GOOGLE"]);

export const oidcExchangeRequestSchema = z
  .object({
    provider: oidcProviderSchema.meta({ example: "GOOGLE" }),
    idToken: z.string().meta({ example: "<oidc-id-token>" }),
    deviceId: z
      .string()
      .optional()
      .meta({ description: "Stable per-device identifier (recommended)." }),
    deviceName: z
      .string()
      .optional()
      .meta({ description: "Human-friendly device name (optional)." }),
  })
  .meta({ id: "OidcExchangeRequestDto" });

export const oidcConnectRequestSchema = z
  .object({
    provider: oidcProviderSchema.meta({ example: "GOOGLE" }),
    idToken: z.string().meta({ example: "<oidc-id-token>" }),
  })
  .meta({ id: "OidcConnectRequestDto" });

export const refreshRequestSchema = z
  .object({
    refreshToken: z.string().meta({ example: "<refresh-token>" }),
  })
  .meta({ id: "RefreshRequestDto" });

export const logoutRequestSchema = z
  .object({
    refreshToken: z.string().meta({ example: "<refresh-token>" }),
  })
  .meta({ id: "LogoutRequestDto" });

export const authUserSchema = z
  .object({
    id: z.string().meta({ example: "3d2c7b2a-2dd6-46a5-8f8e-3b5de8a5b0f0" }),
    email: z.string().meta({ example: "user@example.com" }),
    emailVerified: z.boolean().meta({ example: false }),
    authMethods: z
      .array(authMethodSchema)
      .optional()
      .meta({
        example: ["PASSWORD", "GOOGLE"],
        description:
          "Linked authentication methods on this account. Omitted on token refresh responses.",
      }),
  })
  .meta({ id: "AuthUserDto" });

export const authResultSchema = z
  .object({
    user: authUserSchema,
    accessToken: z.string().meta({ example: "<access-token>" }),
    refreshToken: z.string().meta({ example: "<refresh-token>" }),
  })
  .meta({ id: "AuthResultDto" });

export const authResultEnvelopeSchema = z
  .object({ data: authResultSchema })
  .meta({ id: "AuthResultEnvelopeDto" });

export const authResultWithMeSchema = z
  .object({
    user: meSchema,
    accessToken: z.string().meta({ example: "<access-token>" }),
    refreshToken: z.string().meta({ example: "<refresh-token>" }),
  })
  .meta({ id: "AuthResultWithMeDto" });

export const authResultWithMeEnvelopeSchema = z
  .object({ data: authResultWithMeSchema })
  .meta({ id: "AuthResultWithMeEnvelopeDto" });

export const jwksResponseSchema = z.object({ keys: z.array(z.object({})) });

export type OidcExchangeRequest = z.infer<typeof oidcExchangeRequestSchema>;
export type OidcConnectRequest = z.infer<typeof oidcConnectRequestSchema>;
