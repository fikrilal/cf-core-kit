import type { Clock } from "../../platform/clock/clock";
import type { AppConfig } from "../../platform/config/config";
import { issueAccessToken } from "../../platform/auth/access-token";
import type { KeyRing } from "../../platform/auth/keys";
import { randomBase64Url, sha256Base64Url } from "../../platform/crypto/crypto";
import type { Database } from "../../platform/db/db";
import { createSessionWithToken } from "./repository";

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
