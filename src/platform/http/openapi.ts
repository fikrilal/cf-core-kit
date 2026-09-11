import type { AppErrorCode } from "../../shared/error-codes";

export type OperationMethod =
  "get" | "post" | "put" | "patch" | "delete" | "options" | "head";

export type OperationMetadata = Readonly<{
  method: OperationMethod;
  path: string;
  operationId: string;
  errorCodes: readonly AppErrorCode[];
}>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function applyErrorCodeExtensions(
  document: unknown,
  operations: readonly OperationMetadata[],
): void {
  if (!isRecord(document)) throw new Error("openapi document is not an object");

  const paths = document.paths;
  if (!isRecord(paths)) throw new Error("openapi document has no paths");

  for (const operation of operations) {
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

    if (operationObject.operationId !== operation.operationId) {
      throw new Error(
        `operationId mismatch for ${operation.method} ${operation.path}: expected ${operation.operationId}`,
      );
    }

    operationObject["x-error-codes"] = [...operation.errorCodes];
  }
}
