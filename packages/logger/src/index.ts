import pino from "pino";

export interface LoggerOptions {
  /** Additional default fields merged into every log line */
  defaultFields?: Record<string, unknown>;
  /** Minimum log level (defaults to LOG_LEVEL env or "info") */
  level?: string;
  /** Service name attached to every log line */
  service: string;
}

/**
 * Create a structured Pino logger for a service.
 *
 * - JSON output in production, pretty-printed in development
 * - ISO timestamps
 * - Level as string label
 *
 * @example
 * ```ts
 * const logger = createLogger("api");
 * // or with options object:
 * const logger = createLogger({ service: "api", level: "debug" });
 * ```
 */
export function createLogger(
  nameOrOpts: string | LoggerOptions,
  level?: string
) {
  const opts: LoggerOptions =
    typeof nameOrOpts === "string"
      ? { service: nameOrOpts, level }
      : nameOrOpts;

  const resolvedLevel = opts.level ?? process.env.LOG_LEVEL ?? "info";
  const isDev = process.env.NODE_ENV === "development";

  return pino({
    name: opts.service,
    level: resolvedLevel,
    transport: isDev
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Merge service name and any default fields into every log line
    base: {
      service: opts.service,
      ...(opts.defaultFields ?? {}),
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;

/**
 * Create a child logger with request context.
 * Attaches requestId, userId, orgId, sessionId, taskId, or any custom fields
 * to every subsequent log line from the returned logger.
 *
 * @example
 * ```ts
 * const reqLogger = withContext(logger, { requestId: req.id, orgId: "org_123" });
 * reqLogger.info("handling request");
 * ```
 */
export function withContext(
  logger: Logger,
  context: {
    requestId?: string;
    userId?: string;
    orgId?: string;
    sessionId?: string;
    taskId?: string;
    [key: string]: unknown;
  }
): Logger {
  return logger.child(context) as Logger;
}

/**
 * Create a child logger scoped to a specific request.
 * Shorthand for withContext with requestId as the primary key.
 */
export function withRequestId(logger: Logger, requestId: string): Logger {
  return logger.child({ requestId }) as Logger;
}

/**
 * Measure and log execution duration of an async function.
 *
 * @example
 * ```ts
 * const result = await withTiming(logger, "db-query", () => db.select(...));
 * ```
 */
export async function withTiming<T>(
  logger: Logger,
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = Math.round(performance.now() - start);
    logger.info(
      { label, durationMs: duration },
      `${label} completed in ${duration}ms`
    );
    return result;
  } catch (error) {
    const duration = Math.round(performance.now() - start);
    logger.error(
      { label, durationMs: duration, error },
      `${label} failed after ${duration}ms`
    );
    throw error;
  }
}
