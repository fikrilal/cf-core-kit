import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";

import worker from "../../src/worker";
import { authEnv } from "../auth-fixtures";
import { expectData, expectProblem, uniqueEmail } from "../support/assertions";
import { describeIntegration } from "../support/suite";
import {
  randomBase64Url,
  sha256Base64Url,
} from "../../src/platform/crypto/crypto";
import { refreshTokens, sessions, users } from "../../src/platform/db/schema";

const EXPIRES_AT = new Date("2027-06-01T00:00:00.000Z");

/**
 * End-to-end evidence for the `auth.refresh-rotation` oracle: the composed worker, real D1, and no
 * test-only wiring. Rotation itself is also asserted under `src/features/auth/sessions/`, but only here
 * does the whole surface run together — routing, keys, persistence, and reuse detection.
 */
describeIntegration("refresh rotation through the composed worker", (suite) => {
  beforeEach(async () => {
    await suite.clean();
  });

  async function seedSession() {
    const db = suite.db();
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const refreshToken = randomBase64Url(32);
    const now = new Date();

    await db.insert(users).values({
      id: userId,
      email: uniqueEmail("rotate"),
      emailVerifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sessions).values({
      id: sessionId,
      userId,
      lastSeenAt: now,
      expiresAt: EXPIRES_AT,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(refreshTokens).values({
      id: crypto.randomUUID(),
      sessionId,
      tokenHash: await sha256Base64Url(refreshToken),
      expiresAt: EXPIRES_AT,
      createdAt: now,
      updatedAt: now,
    });

    return { userId, sessionId, refreshToken };
  }

  function refresh(token: string) {
    return worker.fetch(
      new Request("https://example.com/v1/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: token }),
      }),
      authEnv(),
    );
  }

  it("rotates, then revokes the session when the rotated token is replayed", async () => {
    const seeded = await seedSession();

    const first = await expectData(await refresh(seeded.refreshToken));
    const rotated = String(first.refreshToken);

    expect(rotated).not.toBe(seeded.refreshToken);
    expect(first.user).toMatchObject({ id: seeded.userId });

    const reuse = await refresh(seeded.refreshToken);

    await expectProblem(reuse, 401, "AUTH_REFRESH_TOKEN_REUSED");

    const db = suite.db();
    const sessionRows = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, seeded.sessionId));

    expect(sessionRows[0]?.revokedAt).toBeInstanceOf(Date);

    const activeTokens = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.sessionId, seeded.sessionId),
          isNull(refreshTokens.revokedAt),
        ),
      );

    expect(activeTokens).toHaveLength(0);

    const afterRevocation = await refresh(rotated);

    await expectProblem(afterRevocation, 401, "AUTH_SESSION_REVOKED");
  });
});
