import type { Clock } from "../../platform/clock/clock";
import type { AppConfig } from "../../platform/config/config";
import { issueAccessToken } from "../../platform/auth/access-token";
import type { KeyRing } from "../../platform/auth/keys";
import { randomBase64Url, sha256Base64Url } from "../../platform/crypto/crypto";
import type { Database } from "../../platform/db/db";
import { toAuthUserPayload, type AuthUserPayload } from "../users/index";
import {
  internalError,
  refreshTokenExpired,
  refreshTokenInvalid,
  refreshTokenReused,
  sessionRevoked,
  userSuspended,
} from "./auth.errors";
import {
  createSessionWithToken,
  findRefreshTokenByHash,
  findSessionById,
  findUserById,
  revokeSessionAndTokens,
  rotateRefreshToken,
  type RefreshTokenRow,
  type SessionRow,
  type UserRow,
} from "./repository";

const REFRESH_TOKEN_BYTES = 32;
const MAX_USER_AGENT_LENGTH = 512;

export type IssuedSession = Readonly<{
  sessionId: string;
  accessToken: string;
  refreshToken: string;
}>;

export type IssueSessionInput = Readonly<{
  db: Database;
  clock: Clock;
  config: AppConfig;
  keyRing: KeyRing;
  user: Readonly<{
    id: string;
    emailVerified: boolean;
    roles: readonly string[];
  }>;
  device: Readonly<{ id?: string; name?: string }>;
  ip: string | undefined;
  userAgent: string | undefined;
}>;

export async function issueSession(
  input: IssueSessionInput,
): Promise<IssuedSession> {
  const now = input.clock.now();
  const sessionId = crypto.randomUUID();
  const refreshToken = randomBase64Url(REFRESH_TOKEN_BYTES);
  const tokenHash = await sha256Base64Url(refreshToken);
  const expiresAt = new Date(
    now.getTime() + input.config.authRefreshTokenTtlSeconds * 1000,
  );

  const accessToken = await issueAccessToken({
    keyRing: input.keyRing,
    now,
    ttlSeconds: input.config.authAccessTokenTtlSeconds,
    userId: input.user.id,
    sessionId,
    emailVerified: input.user.emailVerified,
    roles: input.user.roles,
    issuer: input.config.authIssuer,
    audience: input.config.authAudience,
  });

  await createSessionWithToken(input.db, {
    session: {
      id: sessionId,
      userId: input.user.id,
      deviceId: input.device.id ?? null,
      deviceName: input.device.name ?? null,
      activeKey:
        input.device.id === undefined
          ? null
          : `${input.user.id}:${input.device.id}`,
      ip: input.ip ?? null,
      userAgent:
        input.userAgent === undefined
          ? null
          : input.userAgent.slice(0, MAX_USER_AGENT_LENGTH),
      lastSeenAt: now,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    },
    token: {
      id: crypto.randomUUID(),
      sessionId,
      tokenHash,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    },
    revokeActiveKey:
      input.device.id === undefined
        ? undefined
        : `${input.user.id}:${input.device.id}`,
  });

  return { sessionId, accessToken, refreshToken };
}

export type RefreshedSession = Readonly<{
  user: AuthUserPayload;
  accessToken: string;
  refreshToken: string;
}>;

export type RefreshSessionInput = Readonly<{
  db: Database;
  clock: Clock;
  config: AppConfig;
  keyRing: KeyRing;
  refreshToken: string;
  ip: string | undefined;
  userAgent: string | undefined;
}>;

function classifyRefresh(
  current: RefreshTokenRow,
  session: SessionRow,
  user: UserRow,
  now: Date,
): "ok" | "reused" {
  if (user.status === "DELETED") throw refreshTokenInvalid();
  if (user.status === "SUSPENDED") throw userSuspended();
  if (session.revokedAt !== null) throw sessionRevoked();

  const expired =
    current.expiresAt.getTime() <= now.getTime() ||
    session.expiresAt.getTime() <= now.getTime();
  if (expired) throw refreshTokenExpired();

  if (current.revokedAt !== null || current.replacedById !== null) {
    return "reused";
  }

  return "ok";
}

export async function refreshSession(
  input: RefreshSessionInput,
): Promise<RefreshedSession> {
  const now = input.clock.now();
  const tokenHash = await sha256Base64Url(input.refreshToken);
  const current = await findRefreshTokenByHash(input.db, tokenHash);
  if (current === undefined) throw refreshTokenInvalid();

  const session = await findSessionById(input.db, current.sessionId);
  if (session === undefined) throw internalError();

  const user = await findUserById(input.db, session.userId);
  if (user === undefined) throw internalError();

  if (classifyRefresh(current, session, user, now) === "reused") {
    await revokeSessionAndTokens(input.db, session.id, now);

    throw refreshTokenReused();
  }

  const accessToken = await issueAccessToken({
    keyRing: input.keyRing,
    now,
    ttlSeconds: input.config.authAccessTokenTtlSeconds,
    userId: user.id,
    sessionId: session.id,
    emailVerified: user.emailVerifiedAt !== null,
    roles: [user.role],
    issuer: input.config.authIssuer,
    audience: input.config.authAudience,
  });

  const nextToken = randomBase64Url(REFRESH_TOKEN_BYTES);
  const rotated = await rotateRefreshToken(input.db, {
    currentTokenId: current.id,
    replacement: {
      id: crypto.randomUUID(),
      sessionId: session.id,
      tokenHash: await sha256Base64Url(nextToken),
      expiresAt: current.expiresAt,
      createdAt: now,
      updatedAt: now,
    },
    sessionId: session.id,
    now,
    ip: input.ip,
    userAgent:
      input.userAgent === undefined
        ? undefined
        : input.userAgent.slice(0, MAX_USER_AGENT_LENGTH),
  });

  if (!rotated) {
    await revokeSessionAndTokens(input.db, session.id, now);

    throw refreshTokenReused();
  }

  return {
    user: toAuthUserPayload(user),
    accessToken,
    refreshToken: nextToken,
  };
}

export type LogoutSessionInput = Readonly<{
  db: Database;
  clock: Clock;
  refreshToken: string;
}>;

export async function logoutSession(input: LogoutSessionInput): Promise<void> {
  const tokenHash = await sha256Base64Url(input.refreshToken);
  const current = await findRefreshTokenByHash(input.db, tokenHash);
  if (current === undefined) throw refreshTokenInvalid();

  await revokeSessionAndTokens(input.db, current.sessionId, input.clock.now());
}
