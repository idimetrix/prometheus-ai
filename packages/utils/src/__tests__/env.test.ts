import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  apiEnvSchema,
  modelRouterEnvSchema,
  sandboxManagerEnvSchema,
  socketServerEnvSchema,
  validateEnv,
  webEnvSchema,
} from "../env";

describe("validateEnv", () => {
  it("returns typed env when all required vars are present", () => {
    const schema = z.object({
      FOO: z.string().min(1),
      BAR: z.coerce.number().default(42),
    });

    const result = validateEnv(schema, { FOO: "hello" });
    expect(result.FOO).toBe("hello");
    expect(result.BAR).toBe(42);
  });

  it("throws a formatted error when required vars are missing", () => {
    const schema = z.object({
      REQUIRED_VAR: z.string().min(1, "This is required"),
    });

    expect(() => validateEnv(schema, {})).toThrow(
      "Environment validation failed"
    );
    expect(() => validateEnv(schema, {})).toThrow("REQUIRED_VAR");
  });

  it("applies default values for optional vars", () => {
    const schema = z.object({
      OPT: z.string().default("default_value"),
    });

    const result = validateEnv(schema, {});
    expect(result.OPT).toBe("default_value");
  });

  it("coerces port numbers from strings", () => {
    const schema = z.object({
      PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    });

    const result = validateEnv(schema, { PORT: "8080" });
    expect(result.PORT).toBe(8080);
  });
});

describe("apiEnvSchema", () => {
  const validApiEnv = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    REDIS_URL: "redis://localhost:6379",
    CLERK_SECRET_KEY: "sk_test_abc",
    STRIPE_SECRET_KEY: "sk_test_xyz",
    ENCRYPTION_KEY: "a".repeat(64),
    NODE_ENV: "development",
  };

  it("validates a complete API env", () => {
    const result = validateEnv(apiEnvSchema, validApiEnv);
    expect(result.DATABASE_URL).toBe(validApiEnv.DATABASE_URL);
    expect(result.PORT).toBe(4000); // default
    expect(result.CORS_ORIGIN).toBe("http://localhost:3000"); // default
  });

  it("fails when DATABASE_URL is missing", () => {
    const { DATABASE_URL, ...env } = validApiEnv;
    expect(() => validateEnv(apiEnvSchema, env)).toThrow("DATABASE_URL");
  });

  it("fails when ENCRYPTION_KEY is missing", () => {
    const { ENCRYPTION_KEY, ...env } = validApiEnv;
    expect(() => validateEnv(apiEnvSchema, env)).toThrow("ENCRYPTION_KEY");
  });
});

describe("webEnvSchema", () => {
  it("validates a complete web env with defaults", () => {
    const result = validateEnv(webEnvSchema, {
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_abc",
      CLERK_SECRET_KEY: "sk_test_abc",
    });
    expect(result.NEXT_PUBLIC_CLERK_SIGN_IN_URL).toBe("/sign-in");
    expect(result.NEXT_PUBLIC_API_URL).toBe("http://localhost:4000");
  });

  it("fails when NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing", () => {
    expect(() =>
      validateEnv(webEnvSchema, { CLERK_SECRET_KEY: "sk_test_abc" })
    ).toThrow("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  });
});

describe("modelRouterEnvSchema", () => {
  it("defaults all LLM provider keys to undefined", () => {
    const result = validateEnv(modelRouterEnvSchema, {});
    expect(result.OLLAMA_BASE_URL).toBe("http://localhost:11434");
    expect(result.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.MODEL_ROUTER_PORT).toBe(4004);
  });
});

describe("socketServerEnvSchema", () => {
  it("uses default port", () => {
    const result = validateEnv(socketServerEnvSchema, {});
    expect(result.SOCKET_PORT).toBe(4001);
    expect(result.CORS_ORIGIN).toBe("http://localhost:3000");
  });
});

describe("sandboxManagerEnvSchema", () => {
  it("applies sandbox defaults", () => {
    const result = validateEnv(sandboxManagerEnvSchema, {});
    expect(result.WARM_POOL_SIZE).toBe(2);
    expect(result.MAX_POOL_SIZE).toBe(10);
    expect(result.SANDBOX_IDLE_TTL_MS).toBe(1_800_000);
    expect(result.SANDBOX_IMAGE).toBe("node:22-alpine");
  });
});
