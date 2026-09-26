import type { Me } from "../../../shared/contract/users";
import type { MeView } from "./me";

export type AuthUserPayload = Readonly<{
  id: string;
  email: string;
  emailVerified: boolean;
}>;

export function toAuthUserPayload(user: {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
}): AuthUserPayload {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

export function toMePayload(view: MeView): Me {
  return {
    id: view.id,
    email: view.email,
    emailVerified: view.emailVerified,
    roles: [...view.roles],
    authMethods: [...view.authMethods],
    profile: view.profile,
    accountDeletion: view.accountDeletion,
  };
}
