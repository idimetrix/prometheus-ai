import { createLogger } from "@prometheus/logger";

const logger = createLogger("utils:graceful-shutdown");

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShutdownHandler {
  fn: () => Promise<void>;
  name: string;
}

// ─── State ────────────────────────────────────────────────────────────────────

const handlers: ShutdownHandler[] = [];
let isShuttingDown = false;
let isDraining = false;

/** Maximum time to wait for shutdown handlers to complete (30s) */
const MAX_SHUTDOWN_MS = 30_000;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a shutdown handler that will be called during graceful shutdown.
 *
 * Handlers are executed in reverse registration order (LIFO), so dependencies
 * registered first are shut down last.
 *
 * @param name - Human-readable name for logging
 * @param fn - Async function to execute during shutdown
 */
export function registerShutdownHandler(
  name: string,
  fn: () => Promise<void>
): void {
  handlers.push({ name, fn });
  logger.debug(
    { name, totalHandlers: handlers.length },
    "Shutdown handler registered"
  );
}

/**
 * Check if the process is currently shutting down.
 */
export function isProcessShuttingDown(): boolean {
  return isShuttingDown;
}

/**
 * Get the current health status of the service.
 *
 * - "healthy": Normal operation, accepting new requests
 * - "draining": Shutdown initiated, finishing in-flight requests but rejecting new ones
 * - "shutdown": All handlers have completed, process is exiting
 */
export function getHealthStatus(): "healthy" | "draining" | "shutdown" {
  if (isShuttingDown && !isDraining) {
    return "shutdown";
  }
  if (isDraining) {
    return "draining";
  }
  return "healthy";
}

/**
 * Orchestrate graceful shutdown:
 * 1. Stop accepting new connections
 * 2. Drain active requests
 * 3. Close connections
 * 4. Flush metrics and logs
 *
 * All handlers run with a combined timeout of 30s.
 *
 * @param signal - The signal that triggered shutdown (e.g., "SIGTERM")
 */
export async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn(
      { signal },
      "Shutdown already in progress, ignoring duplicate signal"
    );
    return;
  }

  isShuttingDown = true;
  isDraining = true;
  logger.info(
    { signal, handlerCount: handlers.length },
    "Graceful shutdown initiated"
  );

  const deadline = Date.now() + MAX_SHUTDOWN_MS;

  // Execute handlers in reverse order (LIFO)
  const reversedHandlers = [...handlers].reverse();

  for (const handler of reversedHandlers) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      logger.error(
        { handler: handler.name },
        "Shutdown deadline exceeded, skipping remaining handlers"
      );
      break;
    }

    try {
      logger.info({ handler: handler.name }, "Running shutdown handler");
      await Promise.race([
        handler.fn(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Handler "${handler.name}" timed out`)),
            Math.min(remaining, 10_000)
          )
        ),
      ]);
      logger.info({ handler: handler.name }, "Shutdown handler completed");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { handler: handler.name, error: msg },
        "Shutdown handler failed"
      );
    }
  }

  isDraining = false;
  const totalTime = Date.now() - (deadline - MAX_SHUTDOWN_MS);
  logger.info({ signal, totalTimeMs: totalTime }, "Graceful shutdown complete");
}

// ─── Auto-register Signal Handlers ────────────────────────────────────────────

/**
 * Install SIGTERM and SIGINT handlers that trigger graceful shutdown.
 * Should be called once at service startup.
 */
export function installShutdownHandlers(): void {
  const handler = (signal: string) => {
    gracefulShutdown(signal)
      .then(() => {
        process.exit(0);
      })
      .catch(() => {
        process.exit(1);
      });
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));

  // Catch unhandled promise rejections to prevent silent crashes
  process.on("unhandledRejection", (reason) => {
    logger.error(
      { error: reason instanceof Error ? reason.message : String(reason) },
      "Unhandled promise rejection"
    );
  });

  // Catch uncaught exceptions - log and exit gracefully
  process.on("uncaughtException", (error) => {
    logger.error(
      { error: error.message, stack: error.stack },
      "Uncaught exception - initiating shutdown"
    );
    handler("uncaughtException");
  });

  logger.info("Graceful shutdown signal handlers installed");
}
