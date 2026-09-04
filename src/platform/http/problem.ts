import { ErrorCode, type AppErrorCode } from "../../shared/error-codes";
import { AppError, type AppErrorIssue } from "../errors/app-error";

const STATUS_TITLES: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

export function statusTitle(status: number): string {
  return (
    STATUS_TITLES[status] ?? (status >= 500 ? "Internal Server Error" : "Error")
  );
}

export function resolveProblemTitle(params: {
  status: number;
  code: AppErrorCode;
}): string {
  if (params.code === ErrorCode.VALIDATION_FAILED) {
    return "Validation Failed";
  }

  return statusTitle(params.status);
}

export type ProblemDetails = Readonly<{
  type: string;
  title: string;
  status: number;
  detail?: string;
  errors?: readonly AppErrorIssue[];
  code: AppErrorCode;
  traceId?: string;
}>;

type ProblemInput = Readonly<{
  status: number;
  code: AppErrorCode;
  detail?: string;
  issues?: readonly AppErrorIssue[];
  retryAfterSeconds?: number;
}>;

function buildProblemResponse(
  input: ProblemInput,
  requestId: string | undefined,
): Response {
  const problem: ProblemDetails = {
    type: "about:blank",
    title: resolveProblemTitle({ status: input.status, code: input.code }),
    status: input.status,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    ...(input.issues === undefined || input.issues.length === 0
      ? {}
      : { errors: input.issues }),
    code: input.code,
    ...(requestId === undefined ? {} : { traceId: requestId }),
  };

  const headers = new Headers({ "Content-Type": "application/problem+json" });

  if (requestId !== undefined) {
    headers.set("X-Request-Id", requestId);
  }

  if (input.retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(input.retryAfterSeconds));
  }

  return new Response(JSON.stringify(problem), {
    status: input.status,
    headers,
  });
}

export function problemResponse(
  error: unknown,
  requestId: string | undefined,
): Response {
  if (error instanceof AppError) {
    return buildProblemResponse(
      {
        status: error.status,
        code: error.code,
        ...(error.message.length === 0 ? {} : { detail: error.message }),
        ...(error.issues === undefined || error.issues.length === 0
          ? {}
          : { issues: error.issues }),
        ...(error.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: error.retryAfterSeconds }),
      },
      requestId,
    );
  }

  return buildProblemResponse(
    { status: 500, code: ErrorCode.INTERNAL },
    requestId,
  );
}

export function notFoundResponse(requestId: string | undefined): Response {
  return buildProblemResponse(
    { status: 404, code: ErrorCode.NOT_FOUND },
    requestId,
  );
}
