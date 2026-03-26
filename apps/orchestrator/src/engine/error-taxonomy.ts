/**
 * Error Taxonomy for Agent Recovery.
 *
 * Classifies errors into categories that determine the appropriate
 * recovery strategy. Each category maps to a different set of recovery
 * actions in RecoveryStrategy.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:error-taxonomy");

// ---------------------------------------------------------------------------
// Error Categories
// ---------------------------------------------------------------------------

export const ErrorCategory = {
  /** Network timeout, rate limit - retry with backoff */
  TRANSIENT: "transient",
  /** Sandbox crash, OOM - checkpoint restore + retry */
  RECOVERABLE: "recoverable",
  /** Infinite loop, wrong approach - re-plan */
  LOGIC: "logic",
  /** Billing exhausted, permissions denied - stop */
  FATAL: "fatal",
} as const;

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

// ---------------------------------------------------------------------------
// Error Classification Context
// ---------------------------------------------------------------------------

export interface ErrorClassificationContext {
  /** Whether the error is from an invalid tool output */
  isInvalidToolOutput?: boolean;
  /** How many times the same tool call has been repeated */
  repeatedToolCallCount?: number;
  /** HTTP status code, if applicable */
  statusCode?: number;
}

// ---------------------------------------------------------------------------
// Classification Patterns (top-level for performance)
// ---------------------------------------------------------------------------

const TRANSIENT_PATTERNS = [
  /rate.?limit/i,
  /too many requests/i,
  /429/,
  /ECONNREFUSED/,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /EPIPE/,
  /ENETUNREACH/,
  /socket hang up/i,
  /network.?error/i,
  /timeout/i,
  /temporarily unavailable/i,
  /503/,
  /502/,
  /504/,
  /service unavailable/i,
  /gateway timeout/i,
  /bad gateway/i,
];

const RECOVERABLE_PATTERNS = [
  /out of memory/i,
  /OOM/,
  /killed/i,
  /container.*exit/i,
  /sandbox.*not found/i,
  /sandbox.*crashed/i,
  /sandbox.*timeout/i,
  /ENOMEM/,
  /memory.*limit/i,
  /process.*exited/i,
  /signal.*SIGKILL/i,
  /signal.*SIGSEGV/i,
];

const FATAL_PATTERNS = [
  /billing.*exhaust/i,
  /credits.*exhaust/i,
  /no.*credits.*remaining/i,
  /payment.*required/i,
  /402/,
  /permission.*denied/i,
  /forbidden/i,
  /403/,
  /unauthorized/i,
  /401/,
  /authentication.*fail/i,
  /invalid.*api.*key/i,
  /token.*expired/i,
  /account.*suspended/i,
  /quota.*exceeded/i,
];

const LOGIC_PATTERNS = [
  /infinite.*loop/i,
  /maximum.*iterations/i,
  /hallucination/i,
  /invalid.*tool.*output/i,
  /tool.*not.*found/i,
  /malformed.*response/i,
  /json.*parse.*error/i,
  /schema.*validation/i,
];

// Top-level regex for utility functions
const RATE_LIMIT_RE = /rate.?limit/i;
const TOO_MANY_REQUESTS_RE = /too many requests/i;
const STATUS_429_RE = /429/;

const OOM_RE = /out of memory/i;
const OOM_SHORT_RE = /OOM/;
const ENOMEM_RE = /ENOMEM/;
const MEMORY_LIMIT_RE = /memory.*limit/i;

const SANDBOX_NOT_FOUND_RE = /sandbox.*not found/i;
const SANDBOX_CRASHED_RE = /sandbox.*crashed/i;
const CONTAINER_EXIT_RE = /container.*exit/i;
const PROCESS_EXITED_RE = /process.*exited/i;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function classifyByStatusCode(statusCode: number): ErrorCategory | null {
  if (statusCode === 429) {
    return ErrorCategory.TRANSIENT;
  }
  if (statusCode === 402) {
    return ErrorCategory.FATAL;
  }
  if (statusCode === 403 || statusCode === 401) {
    return ErrorCategory.FATAL;
  }
  if (statusCode >= 500 && statusCode < 600) {
    return ErrorCategory.TRANSIENT;
  }
  return null;
}

function matchPatterns(message: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(message));
}

// ---------------------------------------------------------------------------
// Classification Function
// ---------------------------------------------------------------------------

/**
 * Classify an error into a recovery category based on the error message,
 * optional status code, and execution context.
 */
export function classifyError(
  error: Error,
  context?: ErrorClassificationContext
): ErrorCategory {
  const message = error.message;

  // Check status codes first for precise classification
  if (context?.statusCode !== undefined) {
    const byStatus = classifyByStatusCode(context.statusCode);
    if (byStatus) {
      logger.debug(
        { statusCode: context.statusCode, message, category: byStatus },
        "Classified by status code"
      );
      return byStatus;
    }
  }

  // Check repeated tool calls (logic error - spinning)
  if (
    context?.repeatedToolCallCount !== undefined &&
    context.repeatedToolCallCount > 3
  ) {
    logger.debug(
      { repeatedToolCallCount: context.repeatedToolCallCount, message },
      "Classified as LOGIC (repeated tool calls)"
    );
    return ErrorCategory.LOGIC;
  }

  // Check invalid tool output (logic error - hallucination)
  if (context?.isInvalidToolOutput) {
    logger.debug({ message }, "Classified as LOGIC (invalid tool output)");
    return ErrorCategory.LOGIC;
  }

  // Pattern-match against known error signatures
  return classifyByPatterns(message);
}

/**
 * Classify by pattern matching against known error signatures.
 */
function classifyByPatterns(message: string): ErrorCategory {
  if (matchPatterns(message, FATAL_PATTERNS)) {
    logger.debug({ message }, "Classified as FATAL (pattern match)");
    return ErrorCategory.FATAL;
  }

  if (matchPatterns(message, RECOVERABLE_PATTERNS)) {
    logger.debug({ message }, "Classified as RECOVERABLE (pattern match)");
    return ErrorCategory.RECOVERABLE;
  }

  if (matchPatterns(message, TRANSIENT_PATTERNS)) {
    logger.debug({ message }, "Classified as TRANSIENT (pattern match)");
    return ErrorCategory.TRANSIENT;
  }

  if (matchPatterns(message, LOGIC_PATTERNS)) {
    logger.debug({ message }, "Classified as LOGIC (pattern match)");
    return ErrorCategory.LOGIC;
  }

  // Default: treat unknown errors as transient (safest for retry)
  logger.warn({ message }, "Could not classify error, defaulting to TRANSIENT");
  return ErrorCategory.TRANSIENT;
}

/**
 * Check if an error is a rate limit error specifically.
 * Useful for deciding whether to switch providers.
 */
export function isRateLimitError(error: Error): boolean {
  return (
    RATE_LIMIT_RE.test(error.message) ||
    TOO_MANY_REQUESTS_RE.test(error.message) ||
    STATUS_429_RE.test(error.message)
  );
}

/**
 * Check if an error is an OOM / memory-related error.
 */
export function isOOMError(error: Error): boolean {
  return (
    OOM_RE.test(error.message) ||
    OOM_SHORT_RE.test(error.message) ||
    ENOMEM_RE.test(error.message) ||
    MEMORY_LIMIT_RE.test(error.message)
  );
}

/**
 * Check if an error indicates a sandbox crash.
 */
export function isSandboxCrashError(error: Error): boolean {
  return (
    SANDBOX_NOT_FOUND_RE.test(error.message) ||
    SANDBOX_CRASHED_RE.test(error.message) ||
    CONTAINER_EXIT_RE.test(error.message) ||
    PROCESS_EXITED_RE.test(error.message)
  );
}
