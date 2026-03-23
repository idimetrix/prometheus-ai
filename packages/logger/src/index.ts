import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";

/**
 * Async local storage for trace context propagation into log lines.
 * Services can call `runWithLogContext()` to inject trace_id and request_id
 * into all log lines within the async scope.
 */
export interface LogContext {
  request_id?: string;
  trace_id?: string;
  [key: string]: unknown;
}

export const logContextStorage = new AsyncLocalStorage<LogContext>();

/**
 * Run a function with trace/request context that is automatically
 * injected into every log line produced within the scope.
 */
export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T {
  return logContextStorage.run(ctx, fn);
}

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

  const redactPaths = [
    "password",
    "token",
    "secret",
    "apiKey",
    "authorization",
    "cookie",
  ];

  return pino({
    name: opts.service,
    level: resolvedLevel,
    redact: {
      paths: redactPaths,
      censor: "[REDACTED]",
    },
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
    mixin() {
      const ctx = logContextStorage.getStore();
      if (!ctx) {
        return {};
      }
      const mixed: Record<string, unknown> = {};
      if (ctx.trace_id) {
        mixed.trace_id = ctx.trace_id;
      }
      if (ctx.request_id) {
        mixed.request_id = ctx.request_id;
      }
      return mixed;
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
