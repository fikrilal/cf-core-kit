export interface HttpVariables {
  requestId: string;
  principalId?: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: HttpVariables;
}
