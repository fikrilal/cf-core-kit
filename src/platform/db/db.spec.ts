import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb, runBatch, type Database } from "./db";

async function createItemsTable(db: Database): Promise<void> {
  await db.run(sql`DROP TABLE IF EXISTS test_items`);
  await db.run(
    sql`CREATE TABLE test_items (id TEXT PRIMARY KEY, label TEXT NOT NULL)`,
  );
}

async function countItems(db: Database): Promise<number> {
  const rows = await db.all<{ total: number }>(
    sql`SELECT COUNT(*) AS total FROM test_items`,
  );

  return rows[0]?.total ?? 0;
}

describe("createDb", () => {
  it("round-trips rows through the D1 binding", async () => {
    const db = createDb(env.DB);

    await createItemsTable(db);
    await db.run(sql`INSERT INTO test_items (id, label) VALUES ('a', 'first')`);

    const rows = await db.all<{ id: string; label: string }>(
      sql`SELECT id, label FROM test_items`,
    );

    expect(rows).toEqual([{ id: "a", label: "first" }]);
  });

  it("runs sanity queries against the binding", async () => {
    const db = createDb(env.DB);
    const row = await db.get<{ one: number }>(sql`SELECT 1 AS one`);

    expect(row).toEqual({ one: 1 });
  });
});

describe("runBatch", () => {
  it("applies all statements and returns ordered results", async () => {
    const db = createDb(env.DB);

    await createItemsTable(db);

    const results = await runBatch(db, [
      db.run(sql`INSERT INTO test_items (id, label) VALUES ('a', 'first')`),
      db.all<{ id: string }>(sql`SELECT id FROM test_items`),
    ]);

    expect(results).toHaveLength(2);
    expect(results[1]).toEqual([{ id: "a" }]);
    await expect(countItems(db)).resolves.toBe(1);
  });

  it("applies no statements when one fails (atomicity)", async () => {
    const db = createDb(env.DB);

    await createItemsTable(db);

    await expect(
      runBatch(db, [
        db.run(sql`INSERT INTO test_items (id, label) VALUES ('a', 'first')`),
        db.run(
          sql`INSERT INTO test_items (id, label) VALUES ('a', 'duplicate')`,
        ),
      ]),
    ).rejects.toThrow();

    await expect(countItems(db)).resolves.toBe(0);
  });
});
