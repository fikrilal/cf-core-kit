import { configFrom } from "./platform/config/request";
import { createApp } from "./platform/http/app";
import { data } from "./platform/http/envelope";
import { requestLogging } from "./platform/http/request-logging";
import { registerHealthRoutes } from "./platform/health/health";
import { registerAuthRoutes } from "./features/auth/auth.routes";
import { registerUsersRoutes } from "./features/users/users.routes";
import { commit, version } from "./version";

export function createWorkerApp(): ReturnType<typeof createApp> {
  const app = createApp();

  app.use(requestLogging());
  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerUsersRoutes(app);

  app.get("/", (context) => {
    const config = configFrom(context);

    return data({
      name: "cf-core-kit",
      version,
      commit,
      appEnv: config.appEnv,
    });
  });

  return app;
}
