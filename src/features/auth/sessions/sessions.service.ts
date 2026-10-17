import { and, asc, desc, eq, gt, lt, or, sql, type SQL } from "drizzle-orm";

import type { Database } from "../../../platform/db/db";
import { sessions } from "../../../platform/db/schema";
import type { MeSession } from "../../../shared/contract/users";
import { encodeCursorV1 } from "../../../shared/list-query/cursor";
import { buildCursorAfterWhere } from "../../../shared/list-query/cursor-after";
import {
  parseCursorDateValue,
  parseCursorStringValue,
  createCursorAfterBuilders,
  mergeWhereClauses,
} from "../../../shared/list-query/where";
import type {
  ListQuery,
  Scalar,
  SortSpec,
} from "../../../shared/list-query/types";
import { findSessionById, revokeSessionAndTokens } from "../shared/repository";

export type SessionSortField = "createdAt" | "id";

export type SessionListPage = Readonly<{
  items: readonly MeSession[];
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
}>;

export type ListUserSessionsInput = Readonly<{
  db: Database;
  userId: string;
  currentSessionId: string;
  query: ListQuery<SessionSortField>;
  now: Date;
}>;

const TRUE = sql`1 = 1`;

const SORT_COLUMNS = {
  createdAt: sessions.createdAt,
  id: sessions.id,
};

const FIELD_OPS = {
  createdAt: {
    equals: (value: Scalar) =>
      eq(sessions.createdAt, parseCursorDateValue("createdAt", value)),
    gt: (value: Scalar) =>
      gt(sessions.createdAt, parseCursorDateValue("createdAt", value)),
    lt: (value: Scalar) =>
      lt(sessions.createdAt, parseCursorDateValue("createdAt", value)),
  },
  id: {
    equals: (value: Scalar) =>
      eq(sessions.id, parseCursorStringValue("id", value)),
    gt: (value: Scalar) => gt(sessions.id, parseCursorStringValue("id", value)),
    lt: (value: Scalar) => lt(sessions.id, parseCursorStringValue("id", value)),
  },
};

function statusFor(
  row: Readonly<{ revokedAt: Date | null; expiresAt: Date }>,
  now: Date,
): MeSession["status"] {
  if (row.revokedAt !== null) return "revoked";
  if (row.expiresAt.getTime() <= now.getTime()) return "expired";

  return "active";
}

function toSessionDto(
  row: typeof sessions.$inferSelect,
  currentSessionId: string,
  now: Date,
): MeSession {
  return {
    id: row.id,
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    ip: row.ip,
    userAgent: row.userAgent,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt === null ? null : row.revokedAt.toISOString(),
    current: row.id === currentSessionId,
    status: statusFor(row, now),
  };
}

function cursorAfter(
  row: typeof sessions.$inferSelect,
  sort: readonly SortSpec<SessionSortField>[],
): Partial<Record<SessionSortField, string>> {
  const after: Partial<Record<SessionSortField, string>> = {};

  for (const spec of sort) {
    switch (spec.field) {
      case "createdAt":
        after.createdAt = row.createdAt.toISOString();
        break;
      case "id":
        after.id = row.id;
        break;
      default: {
        const unexpected: never = spec.field;
        throw new Error(`Unexpected session sort: ${String(unexpected)}`);
      }
    }
  }

  return after;
}

export async function listUserSessions(
  input: ListUserSessionsInput,
): Promise<SessionListPage> {
  const { query } = input;
  const builders = createCursorAfterBuilders<SessionSortField, SQL>({
    fieldOps: FIELD_OPS,
    combiners: {
      and: (clauses) => and(...clauses) ?? TRUE,
      or: (clauses) => or(...clauses) ?? TRUE,
      empty: () => TRUE,
    },
  });
  const cursorWhere =
    query.cursor === undefined
      ? TRUE
      : buildCursorAfterWhere<SessionSortField, SQL>({
          sort: query.sort,
          after: query.cursor.after,
          builders,
        });
  const where = mergeWhereClauses<SQL>({
    clauses: [eq(sessions.userId, input.userId), cursorWhere],
    empty: () => TRUE,
    and: (clauses) => and(...clauses) ?? TRUE,
    isEmpty: (clause) => clause === TRUE,
  });

  const rows = await input.db
    .select()
    .from(sessions)
    .where(where)
    .orderBy(
      ...query.sort.map((spec) =>
        spec.direction === "asc"
          ? asc(SORT_COLUMNS[spec.field])
          : desc(SORT_COLUMNS[spec.field]),
      ),
    )
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page.at(-1);

  return {
    items: page.map((row) =>
      toSessionDto(row, input.currentSessionId, input.now),
    ),
    limit: query.limit,
    hasMore,
    ...(hasMore && last !== undefined
      ? {
          nextCursor: encodeCursorV1({
            v: 1,
            sort: query.normalizedSort,
            after: cursorAfter(last, query.sort),
          }),
        }
      : {}),
  };
}

export type RevokeUserSessionInput = Readonly<{
  db: Database;
  userId: string;
  sessionId: string;
  now: Date;
}>;

export async function revokeUserSession(
  input: RevokeUserSessionInput,
): Promise<boolean> {
  const row = await findSessionById(input.db, input.sessionId);
  if (row?.userId !== input.userId) return false;

  await revokeSessionAndTokens(input.db, row.id, input.now);

  return true;
}
