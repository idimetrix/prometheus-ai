import { describe, expect, it } from "vitest";
import {
  AuthError,
  ConcurrencyError,
  CreditError,
  isPrometheusError,
  PrometheusError,
  ProviderError,
  RateLimitError,
  ResourceNotFoundError,
  SandboxError,
  TimeoutError,
  toPrometheusError,
  ValidationError,
} from "../errors";

describe("PrometheusError", () => {
  it("sets code, statusCode, and metadata", () => {
    const err = new PrometheusError("test", "AUTH_ERROR", { key: "val" });
    expect(err.message).toBe("test");
    expect(err.code).toBe("AUTH_ERROR");
    expect(err.statusCode).toBe(401);
    expect(err.metadata).toEqual({ key: "val" });
    expect(err.name).toBe("PrometheusError");
  });

  it("maps to tRPC code", () => {
    const err = new PrometheusError("test", "RATE_LIMIT_ERROR");
    expect(err.trpcCode).toBe("TOO_MANY_REQUESTS");
  });

  it("falls back to 500 and INTERNAL_SERVER_ERROR for unknown codes", () => {
    const err = new PrometheusError("test", "UNKNOWN_CODE");
    expect(err.statusCode).toBe(500);
    expect(err.trpcCode).toBe("INTERNAL_SERVER_ERROR");
  });

  it("supports ES2022 cause chain", () => {
    const original = new Error("original");
    const err = new PrometheusError(
      "wrapped",
      "INTERNAL_ERROR",
      {},
      {
        cause: original,
      }
    );
    expect(err.cause).toBe(original);
  });

  it("stores correlationId", () => {
    const err = new PrometheusError(
      "test",
      "AUTH_ERROR",
      {},
      {
        correlationId: "corr-123",
      }
    );
    expect(err.correlationId).toBe("corr-123");
  });

  it("serializes to JSON", () => {
    const err = new PrometheusError(
      "msg",
      "VALIDATION_ERROR",
      { f: 1 },
      {
        correlationId: "c-1",
      }
    );
    const json = err.toJSON();
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(json.message).toBe("msg");
    expect(json.statusCode).toBe(400);
    expect(json.metadata).toEqual({ f: 1 });
    expect(json.correlationId).toBe("c-1");
  });

  it("toJSON omits correlationId when not set", () => {
    const err = new PrometheusError("msg", "AUTH_ERROR");
    const json = err.toJSON();
    expect(json.correlationId).toBeUndefined();
  });

  it("generates telemetry attributes", () => {
    const cause = new Error("root cause");
    const err = new PrometheusError(
      "fail",
      "PROVIDER_ERROR",
      { provider: "openai", retries: 3 },
      { cause, correlationId: "tel-1" }
    );
    const tel = err.toTelemetry();
    expect(tel["error.type"]).toBe("PrometheusError");
    expect(tel["error.code"]).toBe("PROVIDER_ERROR");
    expect(tel["error.message"]).toBe("fail");
    expect(tel["error.status_code"]).toBe(502);
    expect(tel["error.correlation_id"]).toBe("tel-1");
    expect(tel["error.cause"]).toBe("root cause");
    expect(tel["error.meta.provider"]).toBe("openai");
    expect(tel["error.meta.retries"]).toBe(3);
  });

  it("toTelemetry filters non-primitive metadata", () => {
    const err = new PrometheusError("test", "INTERNAL_ERROR", {
      str: "ok",
      num: 42,
      bool: true,
      obj: { nested: true },
      arr: [1, 2],
    });
    const tel = err.toTelemetry();
    expect(tel["error.meta.str"]).toBe("ok");
    expect(tel["error.meta.num"]).toBe(42);
    expect(tel["error.meta.bool"]).toBe(true);
    expect(tel["error.meta.obj"]).toBeUndefined();
    expect(tel["error.meta.arr"]).toBeUndefined();
  });
});

describe("Error subclasses", () => {
  it("AuthError sets correct code and status", () => {
    const err = new AuthError("unauthorized");
    expect(err.code).toBe("AUTH_ERROR");
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe("AuthError");
    expect(err).toBeInstanceOf(PrometheusError);
  });

  it("AuthError supports cause", () => {
    const cause = new Error("token expired");
    const err = new AuthError("unauthorized", {}, { cause });
    expect(err.cause).toBe(cause);
  });

  it("ValidationError sets correct code and status", () => {
    const err = new ValidationError("bad input");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.statusCode).toBe(400);
    expect(err.name).toBe("ValidationError");
  });

  it("RateLimitError includes retryAfterMs", () => {
    const err = new RateLimitError("slow down", 5000);
    expect(err.code).toBe("RATE_LIMIT_ERROR");
    expect(err.statusCode).toBe(429);
    expect(err.retryAfterMs).toBe(5000);
    expect(err.metadata.retryAfterMs).toBe(5000);
  });

  it("ResourceNotFoundError formats message", () => {
    const err = new ResourceNotFoundError("User", "usr_123");
    expect(err.message).toBe('User "usr_123" not found');
    expect(err.code).toBe("RESOURCE_NOT_FOUND");
    expect(err.statusCode).toBe(404);
    expect(err.metadata.resourceType).toBe("User");
    expect(err.metadata.resourceId).toBe("usr_123");
  });

  it("CreditError sets correct code and status", () => {
    const err = new CreditError("insufficient credits");
    expect(err.code).toBe("CREDIT_ERROR");
    expect(err.statusCode).toBe(402);
  });

  it("ProviderError includes provider name", () => {
    const err = new ProviderError("API down", "anthropic");
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(err.statusCode).toBe(502);
    expect(err.provider).toBe("anthropic");
    expect(err.metadata.provider).toBe("anthropic");
  });

  it("SandboxError sets correct code and status", () => {
    const err = new SandboxError("container crash");
    expect(err.code).toBe("SANDBOX_ERROR");
    expect(err.statusCode).toBe(500);
  });

  it("TimeoutError includes timeoutMs", () => {
    const err = new TimeoutError("request timed out", 30_000);
    expect(err.code).toBe("TIMEOUT_ERROR");
    expect(err.statusCode).toBe(504);
    expect(err.timeoutMs).toBe(30_000);
    expect(err.metadata.timeoutMs).toBe(30_000);
    expect(err.name).toBe("TimeoutError");
  });

  it("ConcurrencyError includes resource", () => {
    const err = new ConcurrencyError("lock contention", "session:ses_123");
    expect(err.code).toBe("CONCURRENCY_ERROR");
    expect(err.statusCode).toBe(409);
    expect(err.resource).toBe("session:ses_123");
    expect(err.metadata.resource).toBe("session:ses_123");
    expect(err.name).toBe("ConcurrencyError");
  });
});

describe("isPrometheusError", () => {
  it("returns true for PrometheusError instances", () => {
    expect(isPrometheusError(new PrometheusError("x", "AUTH_ERROR"))).toBe(
      true
    );
    expect(isPrometheusError(new AuthError("x"))).toBe(true);
    expect(isPrometheusError(new TimeoutError("x", 1000))).toBe(true);
    expect(isPrometheusError(new ConcurrencyError("x", "r"))).toBe(true);
  });

  it("returns false for non-PrometheusError values", () => {
    expect(isPrometheusError(new Error("x"))).toBe(false);
    expect(isPrometheusError("string")).toBe(false);
    expect(isPrometheusError(null)).toBe(false);
    expect(isPrometheusError(undefined)).toBe(false);
  });
});

describe("toPrometheusError", () => {
  it("returns PrometheusError as-is", () => {
    const err = new AuthError("test");
    expect(toPrometheusError(err)).toBe(err);
  });

  it("wraps Error with cause chain", () => {
    const original = new Error("oops");
    const wrapped = toPrometheusError(original);
    expect(wrapped.code).toBe("INTERNAL_ERROR");
    expect(wrapped.message).toBe("oops");
    expect(wrapped.cause).toBe(original);
    expect(wrapped.metadata.originalName).toBe("Error");
  });

  it("wraps non-Error values", () => {
    const wrapped = toPrometheusError("string error");
    expect(wrapped.code).toBe("INTERNAL_ERROR");
    expect(wrapped.message).toBe("string error");
  });

  it("attaches correlationId when provided", () => {
    const wrapped = toPrometheusError(new Error("x"), "corr-456");
    expect(wrapped.correlationId).toBe("corr-456");
  });
});
