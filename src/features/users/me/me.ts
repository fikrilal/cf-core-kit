import { and, eq, ne } from "drizzle-orm";

import type { Database } from "../../../platform/db/db";
import {
  oidcIdentities,
  users,
  type OidcProvider,
} from "../../../platform/db/schema";
import type { AuthMethod } from "../../../shared/contract/users";

export type MeView = Readonly<{
  id: string;
  email: string;
  emailVerified: boolean;
  roles: readonly string[];
  authMethods: readonly AuthMethod[];
  profile: Readonly<{
    profileImageFileId: string | null;
    displayName: string | null;
    givenName: string | null;
    familyName: string | null;
  }>;
  accountDeletion: Readonly<{
    requestedAt: string;
    scheduledFor: string;
  }> | null;
}>;

export async function loadMe(
  db: Database,
  userId: string,
): Promise<MeView | undefined> {
  const user: typeof users.$inferSelect | undefined = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (user === undefined || user.status === "DELETED") return undefined;

  const identities = await db
    .select({ provider: oidcIdentities.provider })
    .from(oidcIdentities)
    .where(eq(oidcIdentities.userId, userId));

  const authMethodByProvider: Record<OidcProvider, AuthMethod> = {
    GOOGLE: "GOOGLE",
  };
  const authMethods: AuthMethod[] = [];

  for (const identity of identities) {
    authMethods.push(authMethodByProvider[identity.provider]);
  }

  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    roles: [user.role],
    authMethods,
    profile: {
      profileImageFileId: user.profileImageFileId,
      displayName: user.displayName,
      givenName: user.givenName,
      familyName: user.familyName,
    },
    accountDeletion:
      user.deletionRequestedAt !== null && user.deletionScheduledFor !== null
        ? {
            requestedAt: user.deletionRequestedAt.toISOString(),
            scheduledFor: user.deletionScheduledFor.toISOString(),
          }
        : null,
  };
}

export type ProfilePatch = Readonly<{
  displayName?: string | null;
  givenName?: string | null;
  familyName?: string | null;
}>;

export async function updateMeProfile(
  db: Database,
  userId: string,
  patch: ProfilePatch,
  now: Date,
): Promise<MeView | undefined> {
  const columns: Partial<typeof users.$inferInsert> = { updatedAt: now };

  if (patch.displayName !== undefined) columns.displayName = patch.displayName;
  if (patch.givenName !== undefined) columns.givenName = patch.givenName;
  if (patch.familyName !== undefined) columns.familyName = patch.familyName;

  await db
    .update(users)
    .set(columns)
    .where(and(eq(users.id, userId), ne(users.status, "DELETED")));

  return loadMe(db, userId);
}
