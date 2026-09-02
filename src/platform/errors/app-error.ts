import type { AppErrorCode } from "../../shared/error-codes";

export type AppErrorOptions = Readonly<{
  status: number;
  code: AppErrorCode;
  message: string;
  retryAfterSeconds?: number;
}>;

export class AppError extends Error {
  readonly status: number;
  readonly code: AppErrorCode;
  readonly retryAfterSeconds: number | undefined;

  constructor(options: AppErrorOptions) {
    super(options.message);

    this.name = "AppError";
    this.status = options.status;
    this.code = options.code;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}
