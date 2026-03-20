// ─── HTTP and tRPC Error Code Mappings ────────────────────────────────────────

const HTTP_STATUS_MAP: Record<string, number> = {
  AUTH_ERROR: 401,
  VALIDATION_ERROR: 400,
  RATE_LIMIT_ERROR: 429,
  RESOURCE_NOT_FOUND: 404,
  CREDIT_ERROR: 402,
  PROVIDER_ERROR: 502,
  SANDBOX_ERROR: 500,
  INTERNAL_ERROR: 500,
  FORBIDDEN: 403,
  CONFLICT: 409,
};

const TRPC_ERROR_MAP: Record<string, string> = {
  AUTH_ERROR: "UNAUTHORIZED",
  VALIDATION_ERROR: "BAD_REQUEST",
  RATE_LIMIT_ERROR: "TOO_MANY_REQUESTS",
  RESOURCE_NOT_FOUND: "NOT_FOUND",
  CREDIT_ERROR: "PRECONDITION_FAILED",
  PROVIDER_ERROR: "INTERNAL_SERVER_ERROR",
  SANDBOX_ERROR: "INTERNAL_SERVER_ERROR",
  INTERNAL_ERROR: "INTERNAL_SERVER_ERROR",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",
};

// ─── Base Error ───────────────────────────────────────────────────────────────

export class PrometheusError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly metadata: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    metadata: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "PrometheusError";
    this.code = code;
    this.statusCode = HTTP_STATUS_MAP[code] ?? 500;
    this.metadata = metadata;
  }

  /**
   * Get the corresponding tRPC error code.
   */
  get trpcCode(): string {
    return TRPC_ERROR_MAP[this.code] ?? "INTERNAL_SERVER_ERROR";
  }

  /**
   * Serialize to a JSON-safe object for API responses.
   */
  toJSON(): {
    code: string;
    message: string;
    metadata: Record<string, unknown>;
    statusCode: number;
  } {
    return {
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      metadata: this.metadata,
    };
  }
}

// ─── Auth Error ───────────────────────────────────────────────────────────────

export class AuthError extends PrometheusError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, "AUTH_ERROR", metadata);
    this.name = "AuthError";
  }
}

// ─── Validation Error ─────────────────────────────────────────────────────────

export class ValidationError extends PrometheusError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", metadata);
    this.name = "ValidationError";
  }
}

// ─── Rate Limit Error ─────────────────────────────────────────────────────────

export class RateLimitError extends PrometheusError {
  readonly retryAfterMs: number;

  constructor(
    message: string,
    retryAfterMs: number,
    metadata?: Record<string, unknown>
  ) {
    super(message, "RATE_LIMIT_ERROR", { retryAfterMs, ...metadata });
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

// ─── Resource Not Found Error ─────────────────────────────────────────────────

export class ResourceNotFoundError extends PrometheusError {
  constructor(
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, unknown>
  ) {
    super(`${resourceType} "${resourceId}" not found`, "RESOURCE_NOT_FOUND", {
      resourceType,
      resourceId,
      ...metadata,
    });
    this.name = "ResourceNotFoundError";
  }
}

// ─── Credit Error ─────────────────────────────────────────────────────────────

export class CreditError extends PrometheusError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, "CREDIT_ERROR", metadata);
    this.name = "CreditError";
  }
}

// ─── Provider Error ───────────────────────────────────────────────────────────

export class ProviderError extends PrometheusError {
  readonly provider: string;

  constructor(
    message: string,
    provider: string,
    metadata?: Record<string, unknown>
  ) {
    super(message, "PROVIDER_ERROR", { provider, ...metadata });
    this.name = "ProviderError";
    this.provider = provider;
  }
}

// ─── Sandbox Error ────────────────────────────────────────────────────────────

export class SandboxError extends PrometheusError {
  constructor(message: string, metadata?: Record<string, unknown>) {
    super(message, "SANDBOX_ERROR", metadata);
    this.name = "SandboxError";
  }
}

// ─── Helper: Check if value is a PrometheusError ──────────────────────────────

export function isPrometheusError(error: unknown): error is PrometheusError {
  return error instanceof PrometheusError;
}

/**
 * Convert any error to a PrometheusError for consistent error handling.
 */
export function toPrometheusError(error: unknown): PrometheusError {
  if (error instanceof PrometheusError) {
    return error;
  }

  if (error instanceof Error) {
    return new PrometheusError(error.message, "INTERNAL_ERROR", {
      originalName: error.name,
    });
  }

  return new PrometheusError(String(error), "INTERNAL_ERROR");
}
