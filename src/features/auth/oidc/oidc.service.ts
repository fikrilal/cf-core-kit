import type { Clock } from "../../../platform/clock/clock";
import type { AppConfig } from "../../../platform/config/config";
import { getKeyRing } from "../../../platform/auth/keys";
import { runBatch } from "../../../platform/db/db";
import type { Database } from "../../../platform/db/db";
import {
  oidcIdentities,
  users,
  type OidcProvider,
} from "../../../platform/db/schema";
import { loadMe, toMePayload } from "../../users/index";
import type { Me } from "../../../shared/contract/users";
import {
  internalError,
  oidcEmailNotVerified,
  oidcIdentityAlreadyLinked,
  oidcLinkRequired,
  oidcNotConfigured,
  oidcProviderAlreadyLinked,
  oidcTokenInvalid,
  userSuspended,
} from "../shared/auth.errors";
import type { GoogleClaims, IdTokenVerifier } from "./oidc";
import {
  findIdentity,
  findIdentityByUserProvider,
  findUserByEmail,
  findUserById,
  insertIdentity,
  markEmailVerified,
  type UserRow,
} from "../shared/repository";
import { issueSession } from "../sessions/session.service";

export type AuthServiceDependencies = Readonly<{
  db: Database;
  config: AppConfig;
  clock: Clock;
  verifier: IdTokenVerifier;
}>;

export type ExchangeInput = Readonly<{
  provider: OidcProvider;
  idToken: string;
  device: Readonly<{ id?: string; name?: string }>;
  ip: string | undefined;
  userAgent: string | undefined;
}>;

export type ExchangeResult = Readonly<{
  user: Me;
  accessToken: string;
  refreshToken: string;
}>;

const supportedProviders: Record<OidcProvider, "GOOGLE"> = {
  GOOGLE: "GOOGLE",
};

function supportedProvider(provider: OidcProvider): "GOOGLE" {
  return supportedProviders[provider];
}

async function verifyIdToken(
  deps: AuthServiceDependencies,
  idToken: string,
): Promise<GoogleClaims> {
  const verification = await deps.verifier({
    idToken,
    clientIds: deps.config.authOidcGoogleClientIds,
  });

  if (!verification.ok) {
    switch (verification.reason) {
      case "not_configured":
        throw oidcNotConfigured();
      case "invalid":
        throw oidcTokenInvalid();
      default: {
        const unreachable: never = verification.reason;
        throw new Error(
          `Unexpected id token verification: ${String(unreachable)}`,
        );
      }
    }
  }

  if (!verification.claims.emailVerified) throw oidcEmailNotVerified();

  return verification.claims;
}

function assertActive(user: UserRow): void {
  if (user.status === "DELETED") throw oidcTokenInvalid();
  if (user.status === "SUSPENDED") throw userSuspended();
}

async function createUserWithIdentity(
  deps: AuthServiceDependencies,
  claims: GoogleClaims,
  provider: "GOOGLE",
): Promise<UserRow> {
  const now = deps.clock.now();
  const userId = crypto.randomUUID();

  try {
    await runBatch(deps.db, [
      deps.db.insert(users).values({
        id: userId,
        email: claims.email.trim().toLowerCase(),
        emailVerifiedAt: now,
        displayName: claims.name ?? null,
        givenName: claims.givenName ?? null,
        familyName: claims.familyName ?? null,
        createdAt: now,
        updatedAt: now,
      }),
      deps.db.insert(oidcIdentities).values({
        id: crypto.randomUUID(),
        userId,
        provider,
        subject: claims.subject,
        email: claims.email,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
  } catch (error) {
    const racedIdentity = await findIdentity(deps.db, provider, claims.subject);

    if (racedIdentity !== undefined) {
      const racedUser = await findUserById(deps.db, racedIdentity.userId);
      if (racedUser === undefined) throw internalError();

      assertActive(racedUser);

      return racedUser;
    }

    if ((await findUserByEmail(deps.db, claims.email)) !== undefined) {
      throw oidcLinkRequired();
    }

    throw error;
  }

  const created = await findUserById(deps.db, userId);
  if (created === undefined) throw internalError();

  return created;
}

export async function exchangeOidc(
  deps: AuthServiceDependencies,
  input: ExchangeInput,
): Promise<ExchangeResult> {
  const provider = supportedProvider(input.provider);
  const claims = await verifyIdToken(deps, input.idToken);
  const existingIdentity = await findIdentity(
    deps.db,
    provider,
    claims.subject,
  );

  let user: UserRow;

  if (existingIdentity !== undefined) {
    const found = await findUserById(deps.db, existingIdentity.userId);
    if (found === undefined) throw internalError();

    assertActive(found);
    user = found;
  } else {
    if ((await findUserByEmail(deps.db, claims.email)) !== undefined) {
      throw oidcLinkRequired();
    }

    user = await createUserWithIdentity(deps, claims, provider);
  }

  const keyRing = await getKeyRing(deps.config);
  const issued = await issueSession({
    db: deps.db,
    clock: deps.clock,
    config: deps.config,
    keyRing,
    user: {
      id: user.id,
      emailVerified: user.emailVerifiedAt !== null,
      roles: [user.role],
    },
    device: input.device,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  const me = await loadMe(deps.db, user.id);
  if (me === undefined) throw internalError();

  return {
    user: toMePayload(me),
    accessToken: issued.accessToken,
    refreshToken: issued.refreshToken,
  };
}

export type ConnectInput = Readonly<{
  provider: OidcProvider;
  idToken: string;
  userId: string;
}>;

async function insertIdentitySafely(
  deps: AuthServiceDependencies,
  input: ConnectInput,
  claims: GoogleClaims,
  now: Date,
  provider: "GOOGLE",
): Promise<void> {
  try {
    await insertIdentity(deps.db, {
      id: crypto.randomUUID(),
      userId: input.userId,
      provider,
      subject: claims.subject,
      email: claims.email,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    await resolveInsertConflict(deps, input, claims, error, provider);
  }
}

async function resolveInsertConflict(
  deps: AuthServiceDependencies,
  input: ConnectInput,
  claims: GoogleClaims,
  error: unknown,
  provider: "GOOGLE",
): Promise<void> {
  const raced = await findIdentity(deps.db, provider, claims.subject);

  if (raced !== undefined) {
    if (raced.userId !== input.userId) throw oidcIdentityAlreadyLinked();

    return;
  }

  const ownProvider = await findIdentityByUserProvider(
    deps.db,
    input.userId,
    provider,
  );
  if (ownProvider !== undefined) throw oidcProviderAlreadyLinked();

  throw error;
}

async function backfillVerifiedEmail(
  deps: AuthServiceDependencies,
  userId: string,
  claims: GoogleClaims,
  now: Date,
): Promise<void> {
  const user = await findUserById(deps.db, userId);
  if (user === undefined) return;
  if (!claims.emailVerified) return;
  if (user.emailVerifiedAt !== null) return;
  if (user.email.trim().toLowerCase() !== claims.email.trim().toLowerCase()) {
    return;
  }

  await markEmailVerified(deps.db, user.id, now);
}

export async function connectOidc(
  deps: AuthServiceDependencies,
  input: ConnectInput,
): Promise<void> {
  const provider = supportedProvider(input.provider);
  const claims = await verifyIdToken(deps, input.idToken);
  const existing = await findIdentity(deps.db, provider, claims.subject);

  if (existing !== undefined) {
    if (existing.userId !== input.userId) throw oidcIdentityAlreadyLinked();

    return;
  }

  const ownProvider = await findIdentityByUserProvider(
    deps.db,
    input.userId,
    provider,
  );
  if (ownProvider !== undefined) throw oidcProviderAlreadyLinked();

  const now = deps.clock.now();

  await insertIdentitySafely(deps, input, claims, now, provider);
  await backfillVerifiedEmail(deps, input.userId, claims, now);
}
