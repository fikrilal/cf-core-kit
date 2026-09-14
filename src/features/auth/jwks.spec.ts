import { describe, expect, it } from "vitest";

import {
  authEnv,
  fakeVerifier,
  generateEd25519Key,
  jsonRecord,
  pick,
  TEST_SIGNING_KID,
  TEST_TOKEN_INSTANT,
} from "../../../test/auth-fixtures";
import { send } from "../../../test/app-request";
import { fixedClock } from "../../platform/clock/clock";
import { createApp } from "../../platform/http/app";
import { registerAuthRoutes } from "./auth.routes";

function jwksRequest(runtimeEnv = authEnv()): Response | Promise<Response> {
  const app = createApp();

  registerAuthRoutes(app, {
    verifier: fakeVerifier(),
    clock: fixedClock(TEST_TOKEN_INSTANT),
  });

  return send(
    app,
    "https://example.com/.well-known/jwks.json",
    undefined,
    runtimeEnv,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("expected a record");
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = entry;
  }

  return result;
}

describe("jwks endpoint", () => {
  it("publishes the configured public key without private material", async () => {
    const response = await jwksRequest();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = await jsonRecord(response);

    expect(Object.keys(body)).toEqual(["keys"]);

    const keys = pick(body, "keys");
    if (!Array.isArray(keys)) throw new Error("expected a keys array");

    expect(keys).toHaveLength(1);

    const entry = asRecord(keys[0]);

    expect(entry.kid).toBe(TEST_SIGNING_KID);
    expect(entry.use).toBe("sig");
    expect(entry.alg).toBe("EdDSA");
    expect(entry.kty).toBe("OKP");
    expect(entry.crv).toBe("Ed25519");
    expect(typeof entry.x).toBe("string");
    expect(entry.d).toBeUndefined();
  });

  it("publishes retired keys from a rotation set in order", async () => {
    const retired = await generateEd25519Key("retired-key");
    const active = await generateEd25519Key("active-key");

    const response = await jwksRequest(
      authEnv({
        AUTH_SIGNING_KEYS_JSON: JSON.stringify([
          active.privateJwk,
          retired.publicJwk,
        ]),
      }),
    );

    expect(response.status).toBe(200);

    const body = await jsonRecord(response);
    const keys = pick(body, "keys");
    if (!Array.isArray(keys)) throw new Error("expected a keys array");

    expect(keys).toHaveLength(2);

    const kids: string[] = [];

    for (const entry of keys) {
      const record = asRecord(entry);
      expect(record.d).toBeUndefined();
      if (typeof record.kid === "string") kids.push(record.kid);
    }

    expect(kids).toEqual(["active-key", "retired-key"]);
  });

  it("reports INTERNAL when no signing keys are configured", async () => {
    const response = await jwksRequest(authEnv({ AUTH_SIGNING_KEYS_JSON: "" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: "INTERNAL",
      status: 500,
    });
  });
});
