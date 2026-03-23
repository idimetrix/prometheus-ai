export class PrometheusError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly recoverable: boolean;

  constructor(
    message: string,
    code: string,
    opts: { details?: Record<string, unknown>; recoverable?: boolean } = {}
  ) {
    super(message);
    this.name = "PrometheusError";
    this.code = code;
    this.details = opts.details ?? {};
    this.recoverable = opts.recoverable ?? false;
  }
}

export class ModelRouterError extends PrometheusError {
  constructor(
    message: string,
    code:
      | "MODEL_UNAVAILABLE"
      | "RATE_LIMITED"
      | "INVALID_SLOT"
      | "TIMEOUT"
      | "CIRCUIT_OPEN",
    opts: { details?: Record<string, unknown>; recoverable?: boolean } = {}
  ) {
    super(message, code, { recoverable: opts.recoverable ?? true, ...opts });
    this.name = "ModelRouterError";
  }
}

export class SandboxError extends PrometheusError {
  constructor(
    message: string,
    code:
      | "EXEC_FAILED"
      | "CONTAINER_NOT_FOUND"
      | "TIMEOUT"
      | "RESOURCE_EXHAUSTED",
    opts: { details?: Record<string, unknown>; recoverable?: boolean } = {}
  ) {
    super(message, code, opts);
    this.name = "SandboxError";
  }
}

export class CreditError extends PrometheusError {
  constructor(
    message: string,
    code: "INSUFFICIENT_CREDITS" | "RESERVATION_EXPIRED" | "LEDGER_MISMATCH",
    opts: { details?: Record<string, unknown>; recoverable?: boolean } = {}
  ) {
    super(message, code, { recoverable: false, ...opts });
    this.name = "CreditError";
  }
}

export class AgentError extends PrometheusError {
  constructor(
    message: string,
    code:
      | "LOW_CONFIDENCE"
      | "MAX_ITERATIONS"
      | "TOOL_BLOCKED"
      | "RBAC_DENIED"
      | "STUCK",
    opts: { details?: Record<string, unknown>; recoverable?: boolean } = {}
  ) {
    super(message, code, opts);
    this.name = "AgentError";
  }
}
