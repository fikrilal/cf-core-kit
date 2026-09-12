import { eq } from "drizzle-orm";

import type { Database } from "../../platform/db/db";
import { oidcIdentities, users } from "../../platform/db/schema";
import type { AuthMethod } from "../../shared/contract/users";

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

  if (user === undefined) return undefined;

  const identities = await db
    .select({ provider: oidcIdentities.provider })
    .from(oidcIdentities)
    .where(eq(oidcIdentities.userId, userId));

  const authMethods: AuthMethod[] = [];
  if (identities.length > 0) {
    authMethods.push("GOOGLE");
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
