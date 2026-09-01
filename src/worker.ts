import { commit, version } from "./version";

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({ name: "cf-core-kit", version, commit });
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler;
