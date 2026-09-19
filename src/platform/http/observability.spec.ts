import { describe, expect, it } from "vitest";

import { authEnv, jsonRecord, pick } from "../../../test/auth-fixtures";
import { send } from "../../../test/app-request";
import { captureConsoleLogs } from "../../../test/queue-fixtures";
import { ErrorCode } from "../../shared/error-codes";
import { AppError } from "../errors/app-error";
import { createApp } from "./app";
import { requestLogging } from "./request-logging";

function buildApp() {
  const app = createApp();

  app.use(requestLogging());
  app.get("/observability/ok", (context) => context.json({ ok: true }));
  app.get("/observability/validation", () => {
    throw new AppError({
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
      issues: [{ field: "x", message: "required" }],
    });
  });
  app.get("/observability/boom", () => {
    throw new Error("boom");
  });

  return app;
}

function recordsFor(
  records: readonly Record<string, unknown>[],
  path: string,
): Record<string, unknown>[] {
  return records.filter((record) => record.path === path);
}

describe("log economy", () => {
  it("logs exactly one info line per successful request and nothing for probes", async () => {
    const { records, restore } = captureConsoleLogs();

    try {
      const response = await send(
        buildApp(),
        "https://example.com/observability/ok",
        undefined,
        authEnv(),
      );
      await send(
        buildApp(),
        "https://example.com/health",
        undefined,
        authEnv(),
      );

      expect(response.status).toBe(200);

      const lines = recordsFor(records, "/observability/ok");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: "info",
        message: "request",
        status: 200,
        method: "GET",
        requestId: response.headers.get("X-Request-Id"),
      });

      expect(recordsFor(records, "/health")).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it("logs exactly one warn line for a returned 404", async () => {
    const { records, restore } = captureConsoleLogs();

    try {
      const response = await send(
        buildApp(),
        "https://example.com/observability/missing",
        undefined,
        authEnv(),
      );

      expect(response.status).toBe(404);

      const lines = recordsFor(records, "/observability/missing");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: "warn",
        message: "request",
        status: 404,
      });
    } finally {
      restore();
    }
  });
});

describe("trace continuity", () => {
  it("carries a client-supplied request id through header, problem, and log", async () => {
    const { records, restore } = captureConsoleLogs();
    const requestId = "req-observability-1";

    try {
      const response = await send(
        buildApp(),
        "https://example.com/observability/validation",
        { headers: { "X-Request-Id": requestId } },
        authEnv(),
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("X-Request-Id")).toBe(requestId);

      const body = await jsonRecord(response);
      expect(pick(body, "traceId")).toBe(requestId);
      expect(pick(body, "code")).toBe("VALIDATION_FAILED");

      const lines = recordsFor(records, "/observability/validation");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: "warn",
        message: "request error",
        requestId,
        status: 400,
        code: "VALIDATION_FAILED",
      });
    } finally {
      restore();
    }
  });

  it("generates an id when none is supplied and logs exactly one error line for a crash", async () => {
    const { records, restore } = captureConsoleLogs();

    try {
      const response = await send(
        buildApp(),
        "https://example.com/observability/boom",
        undefined,
        authEnv(),
      );

      expect(response.status).toBe(500);

      const echoed = response.headers.get("X-Request-Id");
      expect(echoed).toBeTruthy();

      const body = await jsonRecord(response);
      expect(pick(body, "traceId")).toBe(echoed);
      expect(pick(body, "code")).toBe("INTERNAL");

      const lines = recordsFor(records, "/observability/boom");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        level: "error",
        message: "request error",
        requestId: echoed,
        status: 500,
        error: "boom",
      });
      expect(
        recordsFor(records, "/observability/boom").some(
          (line) => line.message === "request",
        ),
      ).toBe(false);
    } finally {
      restore();
    }
  });
});
