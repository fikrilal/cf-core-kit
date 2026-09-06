import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorCode } from "../../shared/error-codes";
import { createApp } from "./app";
import { data } from "./envelope";
import { AppError } from "../errors/app-error";
import { requestLogging } from "./request-logging";

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

function createLoggingApp() {
  const app = createApp();

  app.use(requestLogging());
  app.get("/ok", () => data({ ok: true }));
  app.get("/health", () => new Response("ok"));

  return app;
}

describe("requestLogging", () => {
  it("logs completions with request fields", async () => {
    captureConsole();
    const response = await createLoggingApp().request(
      "https://example.com/ok",
      undefined,
      env,
    );

    expect(response.status).toBe(200);
    expect(loggedLines).toHaveLength(1);
    const line = loggedLines[0] ?? "";

    expect(JSON.parse(line)).toMatchObject({
      level: "info",
      message: "request",
      method: "GET",
      path: "/ok",
      status: 200,
    });
  });

  it("skips health paths", async () => {
    captureConsole();
    await createLoggingApp().request(
      "https://example.com/health",
      undefined,
      env,
    );

    expect(loggedLines).toHaveLength(0);
  });

  it("logs thrown errors once at error level", async () => {
    captureConsole();
    const app = createApp();

    app.use(requestLogging());
    app.get("/boom", () => {
      throw new Error("explode");
    });

    const response = await app.request(
      "https://example.com/boom",
      undefined,
      env,
    );

    expect(response.status).toBe(500);
    expect(loggedLines).toHaveLength(1);
    const line = loggedLines[0] ?? "";

    expect(JSON.parse(line)).toMatchObject({
      level: "error",
      message: "request error",
      error: "explode",
      status: 500,
    });
  });

  it("logs expected errors at warn level", async () => {
    captureConsole();
    const app = createApp();

    app.use(requestLogging());
    app.get("/missing-thing", () => {
      throw new AppError({
        status: 404,
        code: ErrorCode.NOT_FOUND,
        message: "nope",
      });
    });

    const response = await app.request(
      "https://example.com/missing-thing",
      undefined,
      env,
    );

    expect(response.status).toBe(404);
    expect(loggedLines).toHaveLength(1);
    const line = loggedLines[0] ?? "";

    expect(JSON.parse(line)).toMatchObject({
      level: "warn",
      message: "request error",
      status: 404,
      code: "NOT_FOUND",
    });
  });
});
