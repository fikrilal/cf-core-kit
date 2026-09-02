import { getConfig } from "./platform/config/config";
import { commit, version } from "./version";

export default {
  fetch(request: Request, env: Env): Response {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      const config = getConfig(env);

      return Response.json({
        name: "cf-core-kit",
        version,
        commit,
        appEnv: config.appEnv,
      });
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
