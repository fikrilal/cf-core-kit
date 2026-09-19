import { z } from "zod";

const appEnvSchema = z.enum(["dev", "staging", "prod"]);
const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const ttlSecondsSchema = z.coerce.number().int().positive();

const configSchema = z
  .object({
    APP_ENV: appEnvSchema.default("dev"),
    LOG_LEVEL: logLevelSchema.default("info"),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: ttlSecondsSchema.default(900),
    AUTH_REFRESH_TOKEN_TTL_SECONDS: ttlSecondsSchema.default(2592000),
    AUTH_SIGNING_KEYS_JSON: z.string().optional(),
    AUTH_SIGNING_KEYS_JSON_BASE64: z.string().optional(),
    AUTH_OIDC_GOOGLE_CLIENT_IDS: z.string().optional(),
    AUTH_ISSUER: z.string().optional(),
    AUTH_AUDIENCE: z.string().optional(),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_BUCKET: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (value.APP_ENV === "prod" && value.LOG_LEVEL === "debug") {
      context.addIssue({
        code: "custom",
        message: 'must not be "debug" when APP_ENV is "prod"',
        path: ["LOG_LEVEL"],
      });
    }
  });

export type AppEnv = z.infer<typeof appEnvSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;

export type AppConfig = Readonly<{
  appEnv: AppEnv;
  logLevel: LogLevel;
  authAccessTokenTtlSeconds: number;
  authRefreshTokenTtlSeconds: number;
  authSigningKeysJson: string | undefined;
  authSigningKeysJsonBase64: string | undefined;
  authOidcGoogleClientIds: readonly string[];
  authIssuer: string | undefined;
  authAudience: string | undefined;
  r2AccountId: string | undefined;
  r2Bucket: string | undefined;
  r2AccessKeyId: string | undefined;
  r2SecretAccessKey: string | undefined;
}>;

type ConfigKey =
  | "APP_ENV"
  | "LOG_LEVEL"
  | "AUTH_ACCESS_TOKEN_TTL_SECONDS"
  | "AUTH_REFRESH_TOKEN_TTL_SECONDS"
  | "AUTH_SIGNING_KEYS_JSON"
  | "AUTH_SIGNING_KEYS_JSON_BASE64"
  | "AUTH_OIDC_GOOGLE_CLIENT_IDS"
  | "AUTH_ISSUER"
  | "AUTH_AUDIENCE"
  | "R2_ACCOUNT_ID"
  | "R2_BUCKET"
  | "R2_ACCESS_KEY_ID"
  | "R2_SECRET_ACCESS_KEY";

export type ConfigInput = Readonly<Partial<Record<ConfigKey, string>>>;

function parseClientIds(value: string | undefined): readonly string[] {
  if (value === undefined) return [];

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "config"}: ${issue.message}`)
    .join("; ");
}

export function parseConfig(input: ConfigInput): AppConfig {
  const result = configSchema.safeParse(input);

  if (!result.success) {
    throw new Error(`Invalid configuration: ${formatIssues(result.error)}`);
  }

  return Object.freeze({
    appEnv: result.data.APP_ENV,
    logLevel: result.data.LOG_LEVEL,
    authAccessTokenTtlSeconds: result.data.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    authRefreshTokenTtlSeconds: result.data.AUTH_REFRESH_TOKEN_TTL_SECONDS,
    authSigningKeysJson: result.data.AUTH_SIGNING_KEYS_JSON,
    authSigningKeysJsonBase64: result.data.AUTH_SIGNING_KEYS_JSON_BASE64,
    authOidcGoogleClientIds: parseClientIds(
      result.data.AUTH_OIDC_GOOGLE_CLIENT_IDS,
    ),
    authIssuer: result.data.AUTH_ISSUER,
    authAudience: result.data.AUTH_AUDIENCE,
    r2AccountId: result.data.R2_ACCOUNT_ID,
    r2Bucket: result.data.R2_BUCKET,
    r2AccessKeyId: result.data.R2_ACCESS_KEY_ID,
    r2SecretAccessKey: result.data.R2_SECRET_ACCESS_KEY,
  });
}

const configCache = new WeakMap<object, AppConfig>();

export function getConfig(env: ConfigInput): AppConfig {
  const cached = configCache.get(env);

  if (cached !== undefined) {
    return cached;
  }

  const config = parseConfig(env);
  configCache.set(env, config);

  return config;
}
