import { afterEach, describe, expect, it, vi } from "vitest";

import { parseConfig } from "../config/config";
import { createEmailPort } from "./email";

type FetchCall = Readonly<{ url: string; init: RequestInit }>;

function stubFetch(response: Response): FetchCall[] {
  const calls: FetchCall[] = [];

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    calls.push({ url, init: init ?? {} });

    return Promise.resolve(response);
  });

  return calls;
}

function readHeaders(init: RequestInit): Record<string, string> {
  const raw = init.headers;
  if (typeof raw !== "object") {
    throw new Error("expected a header object");
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) headers[key] = String(value);

  return headers;
}

function readBody(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== "string") throw new Error("expected a string body");

  const parsed: unknown = JSON.parse(init.body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected a JSON object body");
  }

  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) record[key] = value;

  return record;
}

const MESSAGE = {
  to: "user@example.com",
  subject: "Verify your email",
  text: "Use this token to verify your email:\n\nraw-token",
};

const CONFIG = parseConfig({
  RESEND_API_KEY: "re_test_key",
  EMAIL_FROM: "no-reply@example.com",
  EMAIL_REPLY_TO: "support@example.com",
});

describe("createEmailPort", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is disabled when the key or from address is missing", async () => {
    const port = createEmailPort(parseConfig({}));

    expect(port.isEnabled()).toBe(false);
    await expect(port.send(MESSAGE)).rejects.toMatchObject({
      code: "not_configured",
    });
  });

  it("posts the message to Resend and returns the provider id", async () => {
    const calls = stubFetch(Response.json({ id: "email-1" }, { status: 200 }));
    const port = createEmailPort(CONFIG);

    expect(port.isEnabled()).toBe(true);
    const result = await port.send({ ...MESSAGE, html: "<p>raw-token</p>" });

    expect(result).toEqual({ id: "email-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(calls[0]?.init.method).toBe("POST");
    expect(readHeaders(calls[0]?.init ?? {}).authorization).toBe(
      "Bearer re_test_key",
    );
    expect(readBody(calls[0]?.init ?? {})).toEqual({
      from: "no-reply@example.com",
      to: ["user@example.com"],
      subject: "Verify your email",
      text: "Use this token to verify your email:\n\nraw-token",
      html: "<p>raw-token</p>",
      reply_to: "support@example.com",
    });
  });

  it("surfaces provider failures as EmailSendError", async () => {
    stubFetch(new Response("nope", { status: 422 }));
    const port = createEmailPort(CONFIG);

    await expect(port.send(MESSAGE)).rejects.toMatchObject({
      code: "provider_error",
    });
  });

  it("rejects responses without an id", async () => {
    stubFetch(Response.json({}, { status: 200 }));
    const port = createEmailPort(CONFIG);

    await expect(port.send(MESSAGE)).rejects.toMatchObject({
      code: "provider_error",
    });
  });

  it("rejects an empty subject before calling the provider", async () => {
    const calls = stubFetch(Response.json({ id: "email-1" }));
    const port = createEmailPort(CONFIG);

    await expect(
      port.send({ ...MESSAGE, subject: "  " }),
    ).rejects.toMatchObject({ code: "provider_error" });
    expect(calls).toHaveLength(0);
  });
});
