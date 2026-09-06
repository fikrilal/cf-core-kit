import type { AppConfig, LogLevel } from "../config/config";
import { redactLogFields } from "./redact";

export type LogFields = Readonly<Record<string, unknown>>;

export type Logger = Readonly<{
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
}>;

export type LoggerOptions = Readonly<{
  appEnv: AppConfig["appEnv"];
  logLevel: LogLevel;
  service?: string;
}>;

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_SERVICE = "cf-core-kit";

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LEVEL_PRIORITY[options.logLevel];
  const base = {
    service: options.service ?? DEFAULT_SERVICE,
    env: options.appEnv,
  };

  const write = (
    level: LogLevel,
    message: string,
    fields?: LogFields,
  ): void => {
    if (LEVEL_PRIORITY[level] < threshold) return;

    const record = {
      level,
      time: new Date().toISOString(),
      message,
      ...base,
      ...(fields === undefined ? {} : redactLogFields(fields)),
    };

    try {
      console.log(JSON.stringify(record));
    } catch {
      console.log(
        JSON.stringify({
          level,
          time: new Date().toISOString(),
          message,
          ...base,
        }),
      );
    }
  };

  return {
    debug: (message, fields) => {
      write("debug", message, fields);
    },
    info: (message, fields) => {
      write("info", message, fields);
    },
    warn: (message, fields) => {
      write("warn", message, fields);
    },
    error: (message, fields) => {
      write("error", message, fields);
    },
  };
}
