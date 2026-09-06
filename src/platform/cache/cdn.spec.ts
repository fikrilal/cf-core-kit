import { describe, expect, it } from "vitest";

import { cdnCacheControl, withCdnCache } from "./cdn";

describe("cdnCacheControl", () => {
  it("renders s-maxage policies", () => {
    expect(cdnCacheControl({ sMaxAgeSeconds: 60 })).toBe("public, s-maxage=60");
    expect(
      cdnCacheControl({
        sMaxAgeSeconds: 300,
        staleWhileRevalidateSeconds: 3600,
      }),
    ).toBe("public, s-maxage=300, stale-while-revalidate=3600");
  });
});

describe("withCdnCache", () => {
  it("sets Cache-Control and preserves other headers", () => {
    const response = Response.json(
      { ok: true },
      { headers: { "X-Custom": "1" } },
    );

    withCdnCache(response, { sMaxAgeSeconds: 60 });

    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=60");
    expect(response.headers.get("X-Custom")).toBe("1");
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  it("overrides an existing Cache-Control", () => {
    const response = Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );

    withCdnCache(response, { sMaxAgeSeconds: 30 });

    expect(response.headers.get("Cache-Control")).toBe("public, s-maxage=30");
  });
});
