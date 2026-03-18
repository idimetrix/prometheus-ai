import pino from "pino";

export function createLogger(name: string, level?: string) {
  return pino({
    name,
    level: level ?? process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "development"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;

/**
 * Create a child logger with request context (requestId, userId, orgId).
 * Useful in HTTP handlers and queue processors.
 */
export function withContext(logger: Logger, context: {
  requestId?: string;
  userId?: string;
  orgId?: string;
  sessionId?: string;
  taskId?: string;
  [key: string]: unknown;
}): Logger {
  return logger.child(context) as Logger;
}

/**
 * Measure and log execution duration of an async function.
 */
export async function withTiming<T>(
  logger: Logger,
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = Math.round(performance.now() - start);
    logger.info({ label, durationMs: duration }, `${label} completed in ${duration}ms`);
    return result;
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    logger.error({ label, durationMs: duration, error }, `${label} failed after ${duration}ms`);
    throw error;
  }
}
