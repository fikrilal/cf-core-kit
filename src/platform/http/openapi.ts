import type { Hook } from "@hono/zod-openapi";

import { ErrorCode, type AppErrorCode } from "../../shared/error-codes";
import { AppError } from "../errors/app-error";
import type { AppEnv } from "./types";
import { zodErrorToIssues } from "./validation";

export type OperationMethod =
  "get" | "post" | "put" | "patch" | "delete" | "options" | "head";

export type OperationParameter = Readonly<{
  name: string;
  in: "query" | "path" | "header";
  required: boolean;
  description?: string;
  schema: Readonly<Record<string, unknown>>;
}>;

export type OperationMetadata = Readonly<{
  method: OperationMethod;
  path: string;
  operationId: string;
  errorCodes: readonly AppErrorCode[];
  parameters?: readonly OperationParameter[];
}>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requirePaths(document: unknown): Record<string, unknown> {
  if (!isRecord(document)) throw new Error("openapi document is not an object");

  const paths = document.paths;
  if (!isRecord(paths)) throw new Error("openapi document has no paths");

  return paths;
}

function requireOperationObject(
  paths: Readonly<Record<string, unknown>>,
  operation: OperationMetadata,
): Record<string, unknown> {
  const pathItem = paths[operation.path];
  if (!isRecord(pathItem)) {
    throw new Error(
      `operation missing from document: ${operation.operationId}`,
    );
  }

  const operationObject = pathItem[operation.method];
  if (!isRecord(operationObject)) {
    throw new Error(
      `operation missing from document: ${operation.operationId}`,
    );
  }

  return operationObject;
}

export function applyOperationParameters(
  document: unknown,
  operations: readonly OperationMetadata[],
): void {
  const paths = requirePaths(document);

  for (const operation of operations) {
    if (operation.parameters === undefined) continue;

    const operationObject = requireOperationObject(paths, operation);

    operationObject.parameters = operation.parameters.map((parameter) => ({
      name: parameter.name,
      in: parameter.in,
      required: parameter.required,
      ...(parameter.description === undefined
        ? {}
        : { description: parameter.description }),
      schema: { ...parameter.schema },
    }));
  }
}

export function applySecuritySchemes(
  document: unknown,
  schemes: Readonly<Record<string, unknown>>,
): void {
  if (!isRecord(document)) throw new Error("openapi document is not an object");

  const components = isRecord(document.components) ? document.components : {};

  document.components = { ...components, securitySchemes: schemes };
}

export function applyErrorCodeExtensions(
  document: unknown,
  operations: readonly OperationMetadata[],
): void {
  const paths = requirePaths(document);

  for (const operation of operations) {
    const operationObject = requireOperationObject(paths, operation);

    if (operationObject.operationId !== operation.operationId) {
      throw new Error(
        `operationId mismatch for ${operation.method} ${operation.path}: expected ${operation.operationId}`,
      );
    }

    operationObject["x-error-codes"] = [...operation.errorCodes];
  }
}

export const openApiValidationHook: Hook<unknown, AppEnv, string, undefined> = (
  result,
) => {
  if (!result.success) {
    throw new AppError({
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
      issues: zodErrorToIssues(result.error),
    });
  }
};
