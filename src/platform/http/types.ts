import type { AccessTokenPrincipal } from "../auth/access-token";

export interface HttpVariables {
  requestId: string;
  principalId?: string;
  principal?: AccessTokenPrincipal;
}

export interface AppEnv {
  Bindings: Env;
  Variables: HttpVariables;
}
