import type { Me } from "../../shared/contract/users";
import type { MeView } from "./me";

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
