export interface HttpVariables {
  requestId: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: HttpVariables;
}
