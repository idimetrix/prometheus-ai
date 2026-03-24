/**
 * Lightweight browser logger for the web app.
 *
 * Wraps console methods with structured output, timestamps, and a service name.
 * Respects NEXT_PUBLIC_LOG_LEVEL (defaults to "info") and silences non-error
 * logs in production.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const SERVICE_NAME = "prometheus-web";

function getConfiguredLevel(): LogLevel {
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_LOG_LEVEL) {
    const level = process.env.NEXT_PUBLIC_LOG_LEVEL.toLowerCase() as LogLevel;
    if (level in LOG_LEVELS) {
      return level;
    }
  }
  return "info";
}

function getEffectiveLevel(): number {
  const isProduction =
    typeof process !== "undefined" && process.env?.NODE_ENV === "production";

  // In production, only show errors unless explicitly configured
  if (isProduction && !process.env?.NEXT_PUBLIC_LOG_LEVEL) {
    return LOG_LEVELS.error;
  }

  return LOG_LEVELS[getConfiguredLevel()];
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= getEffectiveLevel();
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function createLogMethod(level: LogLevel) {
  return (...args: unknown[]): void => {
    if (!shouldLog(level)) {
      return;
    }

    const timestamp = formatTimestamp();
    const prefix = `[${timestamp}] [${SERVICE_NAME}] ${level.toUpperCase()}:`;

    switch (level) {
      case "debug":
        console.debug(prefix, ...args);
        break;
      case "info":
        console.info(prefix, ...args);
        break;
      case "warn":
        console.warn(prefix, ...args);
        break;
      case "error":
        console.error(prefix, ...args);
        break;
      default:
        console.log(prefix, ...args);
    }
  };
}

export const logger = {
  debug: createLogMethod("debug"),
  info: createLogMethod("info"),
  warn: createLogMethod("warn"),
  error: createLogMethod("error"),
};
