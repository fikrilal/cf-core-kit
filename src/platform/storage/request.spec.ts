import { describe, expect, it } from "vitest";

import { authEnv, jsonRecord, pick } from "../../../test/auth-fixtures";
import { send } from "../../../test/app-request";
import { createApp } from "../http/app";
import { presignerFrom } from "./request";

function buildApp() {
  const app = createApp();

  app.get("/r2/url", async (context) => {
    const presigner = presignerFrom(context);
    const url = await presigner.presign({
      method: "GET",
      key: "photos/cat.png",
    });

    return context.json({ url });
  });

  return app;
}

describe("presignerFrom", () => {
  it("answers INTERNAL when the R2 credentials are absent", async () => {
    const response = await send(
      buildApp(),
      "https://example.com/r2/url",
      undefined,
      authEnv(),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: "INTERNAL" });
  });

  it("presigns an object URL when the credentials are configured", async () => {
    const extended = {
      ...authEnv(),
      R2_ACCESS_KEY_ID: "CFEXAMPLEKEY12345",
      R2_SECRET_ACCESS_KEY: "c2VjcmV0LXRlc3Qta2V5",
    };
    const configured: Env = extended;

    const response = await send(
      buildApp(),
      "https://example.com/r2/url",
      undefined,
      configured,
    );

    expect(response.status).toBe(200);

    const body = await jsonRecord(response);
    const url = new URL(String(pick(body, "url")));

    expect(url.host).toBe(
      "00000000000000000000000000000000.r2.cloudflarestorage.com",
    );
    expect(url.pathname).toBe("/cf-core-kit-dev/photos/cat.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
});
