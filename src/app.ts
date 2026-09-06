import { getConfig } from "./platform/config/config";
import { createApp } from "./platform/http/app";
import { data } from "./platform/http/envelope";
import { requestLogging } from "./platform/http/request-logging";
import { registerHealthRoutes } from "./platform/health/health";
import { commit, version } from "./version";

export function createWorkerApp(): ReturnType<typeof createApp> {
  const app = createApp();

  app.use(requestLogging());
  registerHealthRoutes(app);

  app.get("/", (context) => {
    const config = getConfig(context.env);

    return data({
      name: "cf-core-kit",
      version,
      commit,
      appEnv: config.appEnv,
    });
  });

  return app;
}
