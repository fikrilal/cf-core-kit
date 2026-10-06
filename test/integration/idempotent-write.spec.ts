import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";

import worker from "../../src/worker";
import { authEnv, userAccessToken } from "../auth-fixtures";
import { expectData, expectProblem, uniqueEmail } from "../support/assertions";
import { describeIntegration } from "../support/suite";
import type { Database } from "../../src/platform/db/db";
import { users } from "../../src/platform/db/schema";

async function seedUser(db: Database) {
  const userId = crypto.randomUUID();
  const now = new Date();

  await db.insert(users).values({
    id: userId,
    email: uniqueEmail("idem"),
    emailVerifiedAt: now,
    displayName: "Before",
    createdAt: now,
    updatedAt: now,
  });

  return userId;
}

async function patchMe(
  userId: string,
  body: Record<string, unknown>,
  idempotencyKey?: string,
) {
  return worker.fetch(
    new Request("https://example.com/v1/me", {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${await userAccessToken(userId)}`,
        "content-type": "application/json",
        ...(idempotencyKey === undefined
          ? {}
          : { "Idempotency-Key": idempotencyKey }),
      },
      body: JSON.stringify(body),
    }),
    authEnv(),
  );
}

async function rowOf(db: Database, userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId));

  return rows[0];
}

/**
 * End-to-end evidence for the `http.idempotent-write` oracle: a retryable write through the composed
 * worker executes once, replays its stored response with `Idempotency-Replayed: true`, and refuses a key
 * reused with a different payload. The platform spec covers the mechanism; this covers the wiring.
 */
describeIntegration(
  "idempotent writes through the composed worker",
  (suite) => {
    beforeEach(async () => {
      await suite.clean();
    });

    it("executes once and replays the stored response", async () => {
      const userId = await seedUser(suite.db());
      const key = crypto.randomUUID();

      const first = await patchMe(
        userId,
        { profile: { displayName: "After" } },
        key,
      );
      const firstData = await expectData(first);

      expect(first.headers.get("Idempotency-Replayed")).toBeNull();

      const writtenAt = (await rowOf(suite.db(), userId))?.updatedAt.getTime();

      expect(typeof writtenAt).toBe("number");

      const replay = await patchMe(
        userId,
        { profile: { displayName: "After" } },
        key,
      );

      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      await expect(expectData(replay)).resolves.toEqual(firstData);

      const row = await rowOf(suite.db(), userId);

      expect(row?.displayName).toBe("After");
      expect(row?.updatedAt.getTime()).toBe(writtenAt);
    });

    it("rejects the same key with a different payload", async () => {
      const userId = await seedUser(suite.db());
      const key = crypto.randomUUID();

      await expectData(
        await patchMe(userId, { profile: { displayName: "One" } }, key),
      );

      const conflict = await patchMe(
        userId,
        { profile: { displayName: "Two" } },
        key,
      );

      await expectProblem(conflict, 409, "CONFLICT");
    });

    it("leaves unkeyed writes unaffected", async () => {
      const userId = await seedUser(suite.db());

      const response = await patchMe(userId, {
        profile: { displayName: "Unkeyed" },
      });

      await expectData(response);
      expect(response.headers.get("Idempotency-Replayed")).toBeNull();
    });
  },
);
