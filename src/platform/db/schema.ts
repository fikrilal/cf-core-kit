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
  deletionRequestedSessionId: text("deletion_requested_session_id"),
  deletionRequestedTraceId: text("deletion_requested_trace_id"),
  deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
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
    pushPlatform: text("push_platform", {
      enum: ["ANDROID", "IOS", "WEB"],
    }),
    pushToken: text("push_token").unique(),
    pushTokenUpdatedAt: integer("push_token_updated_at", {
      mode: "timestamp_ms",
    }),
    pushTokenRevokedAt: integer("push_token_revoked_at", {
      mode: "timestamp_ms",
    }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
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

export const emailVerificationTokens = sqliteTable(
  "email_verification_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("email_verification_tokens_user_id_idx").on(table.userId)],
);

export const storedFiles = sqliteTable(
  "stored_files",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose", { enum: ["PROFILE_IMAGE"] }).notNull(),
    status: text("status", { enum: ["UPLOADING", "ACTIVE", "DELETED"] })
      .notNull()
      .default("UPLOADING"),
    bucket: text("bucket").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
    traceId: text("trace_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("stored_files_bucket_object_key_unique").on(
      table.bucket,
      table.objectKey,
    ),
    index("stored_files_owner_user_id_idx").on(table.ownerUserId),
  ],
);

export const userAccountDeletionAudits = sqliteTable(
  "user_account_deletion_audits",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorSessionId: text("actor_session_id"),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action", {
      enum: [
        "REQUESTED",
        "CANCELED",
        "FINALIZED",
        "FINALIZE_BLOCKED_LAST_ADMIN",
      ],
    }).notNull(),
    traceId: text("trace_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("user_account_deletion_audits_target_idx").on(
      table.targetUserId,
      table.createdAt,
    ),
    index("user_account_deletion_audits_trace_idx").on(table.traceId),
  ],
);

export const userStatusChangeAudits = sqliteTable(
  "user_status_change_audits",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").notNull(),
    actorSessionId: text("actor_session_id"),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    oldStatus: text("old_status").notNull(),
    newStatus: text("new_status").notNull(),
    reason: text("reason"),
    traceId: text("trace_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("user_status_change_audits_target_idx").on(
      table.targetUserId,
      table.createdAt,
    ),
    index("user_status_change_audits_trace_idx").on(table.traceId),
  ],
);
