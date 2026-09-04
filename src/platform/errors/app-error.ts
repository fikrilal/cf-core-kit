import type { AppErrorCode } from "../../shared/error-codes";

export type AppErrorIssue = Readonly<{
  field?: string;
  message: string;
}>;

export type AppErrorOptions = Readonly<{
  status: number;
  code: AppErrorCode;
  message?: string;
  issues?: readonly AppErrorIssue[];
  retryAfterSeconds?: number;
}>;

export class AppError extends Error {
  readonly status: number;
  readonly code: AppErrorCode;
  readonly issues: readonly AppErrorIssue[] | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message ?? "");

    this.name = "AppError";
    this.status = options.status;
    this.code = options.code;
    this.issues = options.issues;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
