import {
  createRoute,
  type OpenAPIHono,
  type RouteHandler,
} from "@hono/zod-openapi";

import { getKeyRing } from "../../../platform/auth/keys";
import { configFrom } from "../../../platform/config/request";
import type { OperationMetadata } from "../../../platform/http/openapi";
import type { AppEnv } from "../../../platform/http/types";
import { jwksResponseSchema } from "../../../shared/contract/auth";
import { ErrorCode } from "../../../shared/error-codes";

const jwksRoute = createRoute({
  method: "get",
  path: "/.well-known/jwks.json",
  operationId: "auth.jwks.get",
  tags: ["Auth"],
  summary: "JWKS",
  description: "Publishes public keys used to verify access tokens.",
  responses: {
    200: {
      description: "",
      content: { "application/json": { schema: jwksResponseSchema } },
    },
  },
});

export const jwksOperations: readonly OperationMetadata[] = [
  {
    method: "get",
    path: "/.well-known/jwks.json",
    operationId: "auth.jwks.get",
    errorCodes: [ErrorCode.INTERNAL],
  },
];

const jwksHandler: RouteHandler<typeof jwksRoute, AppEnv> = async (context) => {
  const keyRing = await getKeyRing(configFrom(context));
  const keys = keyRing.publicKeys.map((entry) => entry.jwk);

  return context.json({ keys }, 200);
};

export function registerJwksRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(jwksRoute, jwksHandler);
}
