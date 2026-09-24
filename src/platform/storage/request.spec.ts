import { describe, expect, it } from "vitest";

import { authEnv, jsonRecord, pick } from "../../../test/auth-fixtures";
import { send } from "../../../test/app-request";
import { createApp } from "../http/app";
import { objectStorageFrom } from "./request";

function buildApp() {
  const app = createApp();

  app.get("/r2/url", async (context) => {
    const handle = objectStorageFrom(context);
    const url = await handle.storage.presign({
      method: "GET",
      key: "photos/cat.png",
    });

    return context.json({ bucket: handle.bucket, url });
  });

  return app;
}

describe("objectStorageFrom", () => {
  it("answers USERS_OBJECT_STORAGE_NOT_CONFIGURED when credentials are absent", async () => {
    const response = await send(
      buildApp(),
      "https://example.com/r2/url",
      undefined,
      authEnv(),
    );

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toMatchObject({
      code: "USERS_OBJECT_STORAGE_NOT_CONFIGURED",
    });
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

    expect(pick(body, "bucket")).toBe("cf-core-kit-dev");
    expect(url.host).toBe(
      "00000000000000000000000000000000.r2.cloudflarestorage.com",
    );
    expect(url.pathname).toBe("/cf-core-kit-dev/photos/cat.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
});
