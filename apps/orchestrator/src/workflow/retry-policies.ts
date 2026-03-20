import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:workflow:retry-policies");

/** Backoff strategy for retries */
export type BackoffType = "exponential" | "linear" | "constant";

/** Types of steps that can be retried */
export type StepType =
  | "llm_call"
  | "tool_execution"
  | "idempotent"
  | "file_operation"
  | "api_call"
  | "build"
  | "test";

/** Configuration for a retry policy */
export interface RetryPolicy {
  /** Type of backoff between retries */
  backoffType: BackoffType;
  /** Initial delay in milliseconds */
  initialDelayMs: number;
  /** Whether to add jitter to the delay */
  jitter: boolean;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Maximum number of retries */
  maxRetries: number;
}

/** Per-step-type retry policies */
const RETRY_POLICIES: Record<StepType, RetryPolicy> = {
  llm_call: {
    maxRetries: 5,
    backoffType: "exponential",
    initialDelayMs: 1000,
    maxDelayMs: 16_000,
    jitter: true,
  },
  tool_execution: {
    maxRetries: 3,
    backoffType: "linear",
    initialDelayMs: 1000,
    maxDelayMs: 5000,
    jitter: false,
  },
  idempotent: {
    maxRetries: 10,
    backoffType: "exponential",
    initialDelayMs: 500,
    maxDelayMs: 30_000,
    jitter: true,
  },
  file_operation: {
    maxRetries: 3,
    backoffType: "linear",
    initialDelayMs: 500,
    maxDelayMs: 3000,
    jitter: false,
  },
  api_call: {
    maxRetries: 5,
    backoffType: "exponential",
    initialDelayMs: 1000,
    maxDelayMs: 16_000,
    jitter: true,
  },
  build: {
    maxRetries: 2,
    backoffType: "constant",
    initialDelayMs: 2000,
    maxDelayMs: 2000,
    jitter: false,
  },
  test: {
    maxRetries: 3,
    backoffType: "linear",
    initialDelayMs: 1000,
    maxDelayMs: 5000,
    jitter: false,
  },
};

/**
 * Get the retry policy for a given step type.
 */
export function getRetryPolicy(stepType: StepType): RetryPolicy {
  return RETRY_POLICIES[stepType];
}

/**
 * Calculate the delay for a specific retry attempt.
 *
 * @param policy - The retry policy to use
 * @param attempt - The current attempt number (0-based)
 * @returns Delay in milliseconds
 */
export function calculateRetryDelay(
  policy: RetryPolicy,
  attempt: number
): number {
  let delay: number;

  switch (policy.backoffType) {
    case "exponential": {
      delay = policy.initialDelayMs * 2 ** attempt;
      break;
    }
    case "linear": {
      delay = policy.initialDelayMs * (attempt + 1);
      break;
    }
    case "constant": {
      delay = policy.initialDelayMs;
      break;
    }
    default: {
      delay = policy.initialDelayMs;
    }
  }

  // Cap at max delay
  delay = Math.min(delay, policy.maxDelayMs);

  // Add jitter if configured (up to 25% of delay)
  if (policy.jitter) {
    const jitterAmount = delay * 0.25 * Math.random();
    delay += jitterAmount;
  }

  return Math.round(delay);
}

/**
 * Determine if a retry should be attempted.
 */
export function shouldRetry(
  stepType: StepType,
  attempt: number,
  error?: Error
): { retry: boolean; delayMs: number } {
  const policy = getRetryPolicy(stepType);

  if (attempt >= policy.maxRetries) {
    logger.warn(
      { stepType, attempt, maxRetries: policy.maxRetries },
      "Max retries exceeded"
    );
    return { retry: false, delayMs: 0 };
  }

  // Don't retry on non-retryable errors
  if (error && isNonRetryableError(error)) {
    logger.warn(
      { stepType, error: error.message },
      "Non-retryable error, skipping retry"
    );
    return { retry: false, delayMs: 0 };
  }

  const delayMs = calculateRetryDelay(policy, attempt);

  logger.info(
    { stepType, attempt, delayMs, maxRetries: policy.maxRetries },
    "Scheduling retry"
  );

  return { retry: true, delayMs };
}

/**
 * Check if an error is non-retryable (e.g., auth failures, invalid input).
 */
function isNonRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const nonRetryablePatterns = [
    "authentication",
    "unauthorized",
    "forbidden",
    "invalid input",
    "validation failed",
    "not found",
    "quota exceeded",
  ];

  return nonRetryablePatterns.some((pattern) => message.includes(pattern));
}
