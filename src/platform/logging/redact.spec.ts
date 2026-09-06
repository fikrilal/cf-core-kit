import { describe, expect, it } from "vitest";

import { REDACTED, redactLogFields } from "./redact";

describe("redactLogFields", () => {
  it("redacts sensitive keys at the top level", () => {
    expect(
      redactLogFields({ authorization: "Bearer x", token: "t", keep: "ok" }),
    ).toEqual({
      authorization: REDACTED,
      token: REDACTED,
      keep: "ok",
    });
  });

  it("redacts nested and array entries case-insensitively", () => {
    expect(
      redactLogFields({
        headers: { Authorization: "Bearer x", Cookie: "a=b" },
        items: [{ ApiKey: "k" }, { safe: 1 }],
      }),
    ).toEqual({
      headers: { Authorization: REDACTED, Cookie: REDACTED },
      items: [{ ApiKey: REDACTED }, { safe: 1 }],
    });
  });

  it("truncates beyond the depth bound", () => {
    const deep = redactLogFields({
      level1: { level2: { level3: { level4: { level5: { level6: "x" } } } } },
    });

    expect(JSON.stringify(deep)).toContain("[Truncated]");
  });

  it("passes scalars through", () => {
    expect(redactLogFields({ count: 2, flag: true, nothing: null })).toEqual({
      count: 2,
      flag: true,
      nothing: null,
    });
  });
});
