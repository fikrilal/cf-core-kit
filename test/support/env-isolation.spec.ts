import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

/**
 * The optional-service keys must stay out of the ambient pool environment, so every "not configured"
 * path is deterministic: features read config, and the tests decide what is configured. If this spec
 * fails, the key is coming from `.dev.vars` or a `wrangler.jsonc` var — remove it there rather than
 * relaxing the assertion.
 */
const OPTIONAL_SERVICE_KEYS = [
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "EMAIL_REPLY_TO",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ENDPOINT",
  "PUSH_PROVIDER",
  "AUTH_SIGNING_KEYS_JSON",
  "AUTH_SIGNING_KEYS_JSON_BASE64",
] as const;

describe("env isolation: the ambient test environment configures no optional service", () => {
  for (const key of OPTIONAL_SERVICE_KEYS) {
    it(`leaves ${key} unset`, () => {
      const value = (env as unknown as Record<string, unknown>)[key];

      expect(
        value === undefined || value === "",
        `${key} is set in the test environment; specs must inject it (authEnv/overrides), so remove it from .dev.vars or wrangler.jsonc`,
      ).toBe(true);
    });
  }
});
