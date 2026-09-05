import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const idempotencyRecords = sqliteTable("idempotency_records", {
  key: text("key").primaryKey(),
  record: text("record").notNull(),
  expiresAt: integer("expires_at").notNull(),
});
