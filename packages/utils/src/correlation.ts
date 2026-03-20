import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// ─── Async Context for Correlation ID ─────────────────────────────────────────

const correlationStore = new AsyncLocalStorage<string>();

const HEADER_NAME = "X-Request-Id";

/**
 * Get the current correlation ID from async context.
 * Returns undefined if not within a correlation context.
 */
export function getCorrelationId(): string | undefined {
  return correlationStore.getStore();
}

/**
 * Run a function within a correlation ID context.
 *
 * @param id - The correlation ID to propagate
 * @param fn - The function to execute
 */
export function withCorrelationId<T>(id: string, fn: () => T): T {
  return correlationStore.run(id, fn);
}

/**
 * Generate a new correlation ID.
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Get headers to propagate the correlation ID to downstream services.
 */
export function getCorrelationHeaders(): Record<string, string> {
  const id = getCorrelationId();
  if (!id) {
    return {};
  }
  return { [HEADER_NAME]: id };
}

/**
 * Get the correlation ID header name.
 */
export function getCorrelationHeaderName(): string {
  return HEADER_NAME;
}

/**
 * Get the underlying AsyncLocalStorage for framework-specific middleware.
 */
export function getCorrelationStore(): AsyncLocalStorage<string> {
  return correlationStore;
}
