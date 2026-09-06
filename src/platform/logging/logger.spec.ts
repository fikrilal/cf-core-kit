import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "./logger";
import { REDACTED } from "./redact";

const loggedLines: string[] = [];

function captureConsole(): void {
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    loggedLines.push(args.map((arg) => String(arg)).join(" "));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  loggedLines.length = 0;
});

describe("createLogger", () => {
  it("emits JSON lines with base fields", () => {
    captureConsole();
    const logger = createLogger({ appEnv: "dev", logLevel: "info" });

    logger.info("hello", { requestId: "r1" });

    expect(loggedLines).toHaveLength(1);
    const line = loggedLines[0] ?? "";

    expect(JSON.parse(line)).toMatchObject({
      level: "info",
      message: "hello",
      service: "cf-core-kit",
      env: "dev",
      requestId: "r1",
    });
  });

  it("filters below the threshold", () => {
    captureConsole();
    const logger = createLogger({ appEnv: "prod", logLevel: "warn" });

    logger.debug("d");
    logger.info("i");
    logger.warn("w");

    expect(loggedLines).toHaveLength(1);
    expect(loggedLines[0] ?? "").toContain('"level":"warn"');
  });

  it("redacts sensitive fields", () => {
    captureConsole();
    const logger = createLogger({ appEnv: "dev", logLevel: "info" });

    logger.info("auth", { headers: { authorization: "Bearer secret" } });

    expect(loggedLines[0] ?? "").toContain(REDACTED);
    expect(loggedLines[0] ?? "").not.toContain("Bearer secret");
  });

  it("never throws on unserializable fields", () => {
    captureConsole();
    const logger = createLogger({ appEnv: "dev", logLevel: "info" });

    expect(() => {
      logger.info("bigint", { count: BigInt(5) });
    }).not.toThrow();
    expect(loggedLines).toHaveLength(1);
  });
});
