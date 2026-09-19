import { AwsClient } from "aws4fetch";
import { describe, expect, it } from "vitest";

import { fixedClock } from "../clock/clock";
import {
  createObjectPresigner,
  MAX_OBJECT_KEY_LENGTH,
  PRESIGN_DEFAULT_EXPIRY_SECONDS,
  PRESIGN_MAX_EXPIRY_SECONDS,
  type ObjectPresignerConfig,
} from "./presign";

const INSTANT = new Date("2026-06-01T00:00:00.000Z");

const CONFIG: ObjectPresignerConfig = {
  accountId: "123456789abcdef0123456789abcdef",
  bucket: "cf-core-kit-dev",
  accessKeyId: "CFEXAMPLEKEY12345",
  secretAccessKey: "c2VjcmV0LXRlc3Qta2V5",
};

const GOLDEN_GET =
  "https://123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/cf-core-kit-dev/photos/cat.png?X-Amz-Expires=300&X-Amz-Date=20260601T000000Z&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=CFEXAMPLEKEY12345%2F20260601%2Fauto%2Fs3%2Faws4_request&X-Amz-SignedHeaders=host&X-Amz-Signature=2b52fbdb24db8ea40f402f90358ed313896f23cb87fd22fec2ec0787d6e1ca5f";

const GOLDEN_PUT_SIGNATURE =
  "8343f96248e1148f0af9d8b80d55379dff9b5c7bdcd65ec591e54d4e8f1af4fa";

const AWS_VECTOR_SIGNATURE =
  "aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404";

function presigner(instant = INSTANT) {
  return createObjectPresigner(CONFIG, fixedClock(instant));
}

async function signatureOf(
  input: Parameters<ReturnType<typeof presigner>["presign"]>[0],
  instant = INSTANT,
): Promise<string> {
  const url = new URL(await presigner(instant).presign(input));

  return url.searchParams.get("X-Amz-Signature") ?? "";
}

describe("object presigner", () => {
  it("builds the frozen path-style R2 URL for a GET", async () => {
    const url = await presigner().presign({
      method: "GET",
      key: "photos/cat.png",
    });

    expect(url).toBe(GOLDEN_GET);

    const parsed = new URL(url);
    expect(parsed.host).toBe(
      "123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    );
    expect(parsed.pathname).toBe("/cf-core-kit-dev/photos/cat.png");
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe(
      String(PRESIGN_DEFAULT_EXPIRY_SECONDS),
    );
    expect(parsed.searchParams.get("X-Amz-Credential")).toBe(
      "CFEXAMPLEKEY12345/20260601/auto/s3/aws4_request",
    );
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  it("signs the method, so PUT differs from GET for the same key and instant", async () => {
    const get = await signatureOf({ method: "GET", key: "photos/cat.png" });
    const put = await signatureOf({ method: "PUT", key: "photos/cat.png" });

    expect(put).toBe(GOLDEN_PUT_SIGNATURE);
    expect(put).not.toBe(get);
  });

  it("is deterministic for one instant and changes with the clock", async () => {
    const first = await signatureOf({ method: "GET", key: "photos/cat.png" });
    const second = await signatureOf({ method: "GET", key: "photos/cat.png" });
    const later = await signatureOf(
      { method: "GET", key: "photos/cat.png" },
      new Date("2026-06-01T00:00:01.000Z"),
    );

    expect(second).toBe(first);
    expect(later).not.toBe(first);
  });

  it("encodes keys segment-wise and honors an explicit expiry", async () => {
    const url = new URL(
      await presigner().presign({
        method: "PUT",
        key: "/photos/cat image.png",
        expiresInSeconds: 3600,
      }),
    );

    expect(url.pathname).toBe("/cf-core-kit-dev/photos/cat%20image.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
  });
});

describe("object presigner validation", () => {
  it("rejects invalid expiries and keys", async () => {
    const cases = [
      {
        input: { method: "GET", key: "a", expiresInSeconds: 0 },
        field: "expiresInSeconds",
      },
      {
        input: {
          method: "GET",
          key: "a",
          expiresInSeconds: PRESIGN_MAX_EXPIRY_SECONDS + 1,
        },
        field: "expiresInSeconds",
      },
      {
        input: { method: "GET", key: "a", expiresInSeconds: 1.5 },
        field: "expiresInSeconds",
      },
      { input: { method: "GET", key: "   " }, field: "key" },
      {
        input: { method: "GET", key: "x".repeat(MAX_OBJECT_KEY_LENGTH + 1) },
        field: "key",
      },
      { input: { method: "GET", key: "photos//cat.png" }, field: "key" },
      { input: { method: "GET", key: "photos/../cat.png" }, field: "key" },
    ] as const;

    for (const { input, field } of cases) {
      await expect(
        presigner().presign(
          input as Parameters<ReturnType<typeof presigner>["presign"]>[0],
        ),
      ).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        issues: [{ field }],
      });
    }
  });

  it("fails fast on incomplete configuration", () => {
    expect(() =>
      createObjectPresigner(
        { ...CONFIG, secretAccessKey: " " },
        fixedClock(INSTANT),
      ),
    ).toThrow(/secretAccessKey/);
  });
});

describe("pinned SigV4 signer", () => {
  it("reproduces the documented AWS vector", async () => {
    const vectorClient = new AwsClient({
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      service: "s3",
      region: "us-east-1",
    });
    const url = new URL("https://examplebucket.s3.amazonaws.com/test.txt");

    url.searchParams.set("X-Amz-Expires", "86400");

    const signed = await vectorClient.sign(url.toString(), {
      method: "GET",
      aws: { signQuery: true, datetime: "20130524T000000Z" },
    });

    expect(new URL(signed.url).searchParams.get("X-Amz-Signature")).toBe(
      AWS_VECTOR_SIGNATURE,
    );
  });
});
