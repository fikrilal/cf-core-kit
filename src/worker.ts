import { createWorkerApp } from "./app";

const app = createWorkerApp();

export default {
  fetch: (request: Request, env: Env) => app.fetch(request, env),
} satisfies ExportedHandler<Env>;
