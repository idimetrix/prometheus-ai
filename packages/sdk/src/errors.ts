/**
 * Typed error classes for the Prometheus SDK.
 */

/**
 * Base error class for all Prometheus SDK errors.
 */
export class PrometheusError extends Error {
  /** HTTP status code from the API response, if applicable. */
  readonly status: number;
  /** Machine-readable error code from the API. */
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "PrometheusError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Thrown when authentication fails (HTTP 401).
 * Typically means the API key is invalid, expired, or missing.
 */
export class AuthError extends PrometheusError {
  constructor(message = "Authentication failed. Check your API key.") {
    super(message, 401, "auth_error");
    this.name = "AuthError";
  }
}

/**
 * Thrown when the API key lacks the required scope (HTTP 403).
 */
export class ForbiddenError extends PrometheusError {
  constructor(
    message = "API key does not have the required permissions for this action."
  ) {
    super(message, 403, "forbidden");
    this.name = "ForbiddenError";
  }
}

/**
 * Thrown when a requested resource is not found (HTTP 404).
 */
export class NotFoundError extends PrometheusError {
  constructor(message = "The requested resource was not found.") {
    super(message, 404, "not_found");
    this.name = "NotFoundError";
  }
}

/**
 * Thrown when a request conflicts with the current resource state (HTTP 409).
 * For example, attempting to cancel an already-completed task.
 */
export class ConflictError extends PrometheusError {
  constructor(
    message = "The request conflicts with the current state of the resource."
  ) {
    super(message, 409, "conflict");
    this.name = "ConflictError";
  }
}

/**
 * Thrown when a validation or precondition error occurs (HTTP 400 or 412).
 */
export class ValidationError extends PrometheusError {
  constructor(message = "The request was invalid.") {
    super(message, 400, "validation_error");
    this.name = "ValidationError";
  }
}

/**
 * Thrown when rate limited (HTTP 429).
 * The `retryAfterMs` field indicates how long to wait before retrying.
 */
export class RateLimitError extends PrometheusError {
  /** Suggested wait time in milliseconds before retrying. */
  readonly retryAfterMs: number;

  constructor(retryAfterMs = 1000, message = "Rate limit exceeded.") {
    super(message, 429, "rate_limit");
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Thrown when the API returns a server error (HTTP 5xx).
 */
export class ServerError extends PrometheusError {
  constructor(message = "An internal server error occurred.", status = 500) {
    super(message, status, "server_error");
    this.name = "ServerError";
  }
}

/**
 * Thrown when a request times out.
 */
export class TimeoutError extends PrometheusError {
  constructor(message = "The request timed out.") {
    super(message, 0, "timeout");
    this.name = "TimeoutError";
  }
}

/**
 * Maps an HTTP response to the appropriate error class.
 */
export async function throwForStatus(response: Response): Promise<never> {
  let errorMessage: string;
  try {
    const body = (await response.json()) as {
      error?: string;
      message?: string;
    };
    errorMessage = body.message ?? body.error ?? response.statusText;
  } catch {
    errorMessage = response.statusText || `HTTP ${response.status}`;
  }

  switch (response.status) {
    case 400:
    case 412:
      throw new ValidationError(errorMessage);
    case 401:
      throw new AuthError(errorMessage);
    case 403:
      throw new ForbiddenError(errorMessage);
    case 404:
      throw new NotFoundError(errorMessage);
    case 409:
      throw new ConflictError(errorMessage);
    case 429: {
      const retryAfter = response.headers.get("Retry-After");
      const retryMs = retryAfter ? Number(retryAfter) * 1000 : 1000;
      throw new RateLimitError(retryMs, errorMessage);
    }
    default:
      if (response.status >= 500) {
        throw new ServerError(errorMessage, response.status);
      }
      throw new PrometheusError(errorMessage, response.status, "unknown");
  }
}
