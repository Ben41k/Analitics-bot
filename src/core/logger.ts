import pino from "pino";
import type { AppConfig } from "./config.js";

export type Logger = ReturnType<typeof createLogger>;

export function createLogger(config: AppConfig) {
  return pino({
    level: config.LOG_LEVEL,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export function withLogContext(
  logger: Logger,
  ctx: { jobId?: string; requestId?: string; traceId?: string },
): Logger {
  return logger.child(ctx);
}
