import type {
  OperationMetadata,
  OperationParameter,
} from "../../platform/http/openapi";
import { ErrorCode } from "../../shared/error-codes";
import { accountDeletionOperations } from "./account-deletion.routes";
import { profileImageOperations } from "./profile-image.routes";

const SESSION_LIST_PARAMETERS: readonly OperationParameter[] = [
  {
    name: "limit",
    in: "query",
    required: false,
    description: "Max results to return (default 25, max 100).",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
  },
  {
    name: "cursor",
    in: "query",
    required: false,
    description: "Opaque cursor from the previous response meta.nextCursor.",
    schema: { type: "string" },
  },
  {
    name: "sort",
    in: "query",
    required: false,
    description:
      'Comma-separated fields; prefix "-" for descending. Max 3 fields. Default: "-createdAt". Allowed: createdAt, id',
    schema: { type: "string", example: "-createdAt" },
  },
];

export const usersOperations: readonly OperationMetadata[] = [
  {
    method: "get",
    path: "/v1/me",
    operationId: "users.me.get",
    errorCodes: [ErrorCode.UNAUTHORIZED, ErrorCode.INTERNAL],
  },
  {
    method: "patch",
    path: "/v1/me",
    operationId: "users.me.patch",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.IDEMPOTENCY_IN_PROGRESS,
      ErrorCode.CONFLICT,
      ErrorCode.INTERNAL,
    ],
  },
  {
    method: "get",
    path: "/v1/me/sessions",
    operationId: "users.me.sessions.list",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.INTERNAL,
    ],
    parameters: SESSION_LIST_PARAMETERS,
  },
  {
    method: "post",
    path: "/v1/me/sessions/{sessionId}/revoke",
    operationId: "users.me.sessions.revoke",
    errorCodes: [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.NOT_FOUND,
      ErrorCode.INTERNAL,
    ],
  },
  ...profileImageOperations,
  ...accountDeletionOperations,
];
