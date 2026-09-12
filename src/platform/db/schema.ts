import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const USER_ROLES = ["USER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ["ACTIVE", "SUSPENDED", "DELETED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const OIDC_PROVIDERS = ["GOOGLE"] as const;
export type OidcProvider = (typeof OIDC_PROVIDERS)[number];

export const idempotencyRecords = sqliteTable("idempotency_records", {
  key: text("key").primaryKey(),
  record: text("record").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerifiedAt: integer("email_verified_at", { mode: "timestamp_ms" }),
  role: text("role").$type<UserRole>().notNull().default("USER"),
  status: text("status").$type<UserStatus>().notNull().default("ACTIVE"),
  suspendedAt: integer("suspended_at", { mode: "timestamp_ms" }),
  suspendedReason: text("suspended_reason"),
  deletionRequestedAt: integer("deletion_requested_at", {
    mode: "timestamp_ms",
  }),
  deletionScheduledFor: integer("deletion_scheduled_for", {
    mode: "timestamp_ms",
  }),
  displayName: text("display_name"),
  givenName: text("given_name"),
  familyName: text("family_name"),
  profileImageFileId: text("profile_image_file_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const oidcIdentities = sqliteTable(
  "oidc_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<OidcProvider>().notNull(),
    subject: text("subject").notNull(),
    email: text("email"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("oidc_identities_provider_subject_idx").on(
      table.provider,
      table.subject,
    ),
    uniqueIndex("oidc_identities_user_provider_idx").on(
      table.userId,
      table.provider,
    ),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id"),
    deviceName: text("device_name"),
    activeKey: text("active_key").unique(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_revoked_at_idx").on(table.revokedAt),
  ],
);

export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    replacedById: text("replaced_by_id").unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("refresh_tokens_session_id_idx").on(table.sessionId)],
);
