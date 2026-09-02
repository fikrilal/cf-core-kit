import { describe, expect, it } from "vitest";

import { getConfig, parseConfig } from "./config";

describe("parseConfig", () => {
  it("applies defaults for an empty input", () => {
    expect(parseConfig({})).toEqual({ appEnv: "dev", logLevel: "info" });
  });

  it("parses explicit values", () => {
    expect(parseConfig({ APP_ENV: "staging", LOG_LEVEL: "warn" })).toEqual({
      appEnv: "staging",
      logLevel: "warn",
    });
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
