import { getConfig } from "./platform/config/config";
import { createApp } from "./platform/http/app";
import { data } from "./platform/http/envelope";
import { commit, version } from "./version";

const app = createApp();

app.get("/", (context) => {
  const config = getConfig(context.env);

  return data({
    name: "cf-core-kit",
    version,
    commit,
    appEnv: config.appEnv,
  });
});

export default {
  fetch: (request: Request, env: Env) => app.fetch(request, env),
} satisfies ExportedHandler<Env>;
