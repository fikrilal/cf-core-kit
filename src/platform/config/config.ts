import { z } from "zod";

const appEnvSchema = z.enum(["dev", "staging", "prod"]);
const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);

const configSchema = z
  .object({
    APP_ENV: appEnvSchema.default("dev"),
    LOG_LEVEL: logLevelSchema.default("info"),
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
}>;

type ConfigKey = "APP_ENV" | "LOG_LEVEL";

export type ConfigInput = Readonly<Partial<Record<ConfigKey, string>>>;

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
