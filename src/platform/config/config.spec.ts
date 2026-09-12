import { describe, expect, it } from "vitest";

import { getConfig, parseConfig } from "./config";

describe("parseConfig", () => {
  it("applies defaults for an empty input", () => {
    expect(parseConfig({})).toMatchObject({ appEnv: "dev", logLevel: "info" });
  });

  it("parses explicit values", () => {
    expect(
      parseConfig({ APP_ENV: "staging", LOG_LEVEL: "warn" }),
    ).toMatchObject({
      appEnv: "staging",
      logLevel: "warn",
    });
  });

  it("parses auth defaults and client id lists", () => {
    const config = parseConfig({
      AUTH_OIDC_GOOGLE_CLIENT_IDS: "client-a, client-b ,, client-c",
    });

    expect(config.authAccessTokenTtlSeconds).toBe(900);
    expect(config.authRefreshTokenTtlSeconds).toBe(2592000);
    expect(config.authOidcGoogleClientIds).toEqual([
      "client-a",
      "client-b",
      "client-c",
    ]);
    expect(config.authSigningKeysJson).toBeUndefined();
    expect(config.authIssuer).toBeUndefined();
  });

  it("rejects a non-numeric auth TTL", () => {
    expect(() =>
      parseConfig({ AUTH_ACCESS_TOKEN_TTL_SECONDS: "soon" }),
    ).toThrow(/AUTH_ACCESS_TOKEN_TTL_SECONDS/);
  });

  it("rejects an unknown APP_ENV", () => {
    expect(() => parseConfig({ APP_ENV: "production" })).toThrow(/APP_ENV/);
  });

  it("rejects an unknown LOG_LEVEL", () => {
    expect(() => parseConfig({ LOG_LEVEL: "verbose" })).toThrow(/LOG_LEVEL/);
  });

  it("rejects debug logging in prod", () => {
    expect(() => parseConfig({ APP_ENV: "prod", LOG_LEVEL: "debug" })).toThrow(
      /prod/,
    );
  });

  it("returns a frozen config", () => {
    expect(Object.isFrozen(parseConfig({}))).toBe(true);
  });
});

describe("getConfig", () => {
  it("parses once per env object", () => {
    const env = { APP_ENV: "staging" };

    expect(getConfig(env)).toBe(getConfig(env));
  });

  it("parses separately for a different env object", () => {
    const first = getConfig({ APP_ENV: "dev" });
    const second = getConfig({ APP_ENV: "staging" });

    expect(first).not.toBe(second);
    expect(second.appEnv).toBe("staging");
  });
});
