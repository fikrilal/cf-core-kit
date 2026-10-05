import { describe, expect, it } from "vitest";

import {
  assertIntegrationBindings,
  describeIntegration,
  missingBindings,
  REQUIRED_INTEGRATION_BINDINGS,
} from "./suite";
import {
  expectData,
  expectDataArray,
  expectNoContent,
  expectObjectDeleted,
  expectProblem,
  expectRateLimited,
  sessionIdFromToken,
  uniqueEmail,
} from "./assertions";

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function problem(status: number, code: string) {
  return json({ title: "Title", status, code, traceId: "trace-1" }, status, {
    "X-Request-Id": "trace-1",
  });
}

function token(claims: Record<string, unknown>): string {
  return `${btoa("{}")}.${btoa(JSON.stringify(claims))}.signature`;
}

describe("test assertions: each helper accepts the dialect", () => {
  it("expectData returns the envelope data", async () => {
    await expect(expectData(json({ data: { id: "u1" } }))).resolves.toEqual({
      id: "u1",
    });
  });

  it("expectDataArray returns items and validated meta", async () => {
    const list = await expectDataArray(
      json({ data: [{ id: "a" }], meta: { limit: 20, hasMore: false } }),
    );

    expect(list.items).toEqual([{ id: "a" }]);
    expect(list.meta.hasMore).toBe(false);
  });

  it("expectNoContent accepts an empty 204", async () => {
    await expect(
      expectNoContent(new Response(null, { status: 204 })),
    ).resolves.toBeUndefined();
  });

  it("expectProblem returns the problem and checks the request-id echo", async () => {
    await expect(
      expectProblem(problem(401, "UNAUTHORIZED"), 401, "UNAUTHORIZED"),
    ).resolves.toMatchObject({ code: "UNAUTHORIZED", title: "Title" });
  });

  it("expectRateLimited returns the Retry-After promise", async () => {
    const limited = json(
      {
        title: "Too Many Requests",
        status: 429,
        code: "RATE_LIMITED",
        traceId: "trace-1",
      },
      429,
      { "Retry-After": "30", "X-Request-Id": "trace-1" },
    );

    await expect(expectRateLimited(limited)).resolves.toBe(30);
  });

  it("expectObjectDeleted matches the key, not just the method", () => {
    expect(() => {
      expectObjectDeleted(
        [{ method: "DELETE", url: "https://r2.test/uploads/abc" }],
        "uploads/abc",
      );
    }).not.toThrow();
  });

  it("uniqueEmail is unique and shaped", () => {
    const first = uniqueEmail("me");
    const second = uniqueEmail("me");

    expect(first).toMatch(/^me-[0-9a-f-]{36}@example\.com$/);
    expect(first).not.toBe(second);
  });

  it("sessionIdFromToken reads the sid claim", () => {
    expect(sessionIdFromToken(token({ sid: "session-9" }))).toBe("session-9");
  });
});

describe("test assertions: each helper fails when the dialect is wrong", () => {
  it("expectData rejects a problem body", async () => {
    await expect(expectData(problem(500, "INTERNAL"))).rejects.toThrow();
  });

  it("expectDataArray rejects meta without hasMore", async () => {
    await expect(
      expectDataArray(json({ data: [], meta: { limit: 20 } })),
    ).rejects.toThrow();
  });

  it("expectNoContent rejects a body", async () => {
    await expect(expectNoContent(json({ data: {} }))).rejects.toThrow();
  });

  it("expectProblem rejects a wrong code and a missing request-id echo", async () => {
    await expect(
      expectProblem(problem(401, "UNAUTHORIZED"), 401, "FORBIDDEN"),
    ).rejects.toThrow();
    await expect(
      expectProblem(
        json(
          { title: "T", status: 401, code: "UNAUTHORIZED", traceId: "t" },
          401,
          { "X-Request-Id": "other" },
        ),
        401,
        "UNAUTHORIZED",
      ),
    ).rejects.toThrow();
  });

  it("expectRateLimited rejects a 429 without Retry-After", async () => {
    await expect(
      expectRateLimited(problem(429, "RATE_LIMITED")),
    ).rejects.toThrow();
  });

  it("expectObjectDeleted rejects a delete for another key", () => {
    expect(() => {
      expectObjectDeleted(
        [{ method: "DELETE", url: "https://r2.test/uploads/other" }],
        "uploads/abc",
      );
    }).toThrow();
  });

  it("sessionIdFromToken rejects a token without sid", () => {
    expect(() => sessionIdFromToken(token({ sub: "u1" }))).toThrow(/sid/);
    expect(() => sessionIdFromToken("broken")).toThrow();
  });
});

describe("suite contract: bindings are asserted up front", () => {
  it("names every missing binding", () => {
    expect(missingBindings({ DB: {}, JOBS: {} })).toEqual(["TEST_MIGRATIONS"]);
    expect(missingBindings({ DB: {}, JOBS: {}, TEST_MIGRATIONS: {} })).toEqual(
      [],
    );
  });

  it("throws with an actionable message", () => {
    expect(() => {
      assertIntegrationBindings({});
    }).toThrow(/missing DB, TEST_MIGRATIONS, JOBS/);
    expect(() => {
      assertIntegrationBindings({ DB: {}, JOBS: {}, TEST_MIGRATIONS: {} });
    }).not.toThrow();
  });

  it("keeps the declared binding list in sync with what suites need", () => {
    expect([...REQUIRED_INTEGRATION_BINDINGS]).toEqual([
      "DB",
      "TEST_MIGRATIONS",
      "JOBS",
    ]);
    expect(typeof describeIntegration).toBe("function");
  });
});
