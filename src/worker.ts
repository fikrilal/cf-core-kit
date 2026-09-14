import { createWorkerApp } from "./app";

export { AuthRateLimiter } from "./platform/rate-limit/rate-limiter";

const app = createWorkerApp();

export default {
  fetch: (request: Request, env: Env) => app.fetch(request, env),
} satisfies ExportedHandler<Env>;
