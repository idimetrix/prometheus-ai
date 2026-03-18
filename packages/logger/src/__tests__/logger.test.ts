import { afterEach, describe, expect, it } from "vitest";
import { createLogger, withContext, withRequestId, withTiming } from "../index";

// Ensure clean env for each test
const originalLogLevel = process.env.LOG_LEVEL;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalLogLevel === undefined) {
    Reflect.deleteProperty(process.env, "LOG_LEVEL");
  } else {
    process.env.LOG_LEVEL = originalLogLevel;
  }
  if (originalNodeEnv === undefined) {
    Reflect.deleteProperty(process.env, "NODE_ENV");
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
});

describe("createLogger", () => {
  it("creates a logger with a string name", () => {
    const logger = createLogger("test-service");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("creates a logger with options object", () => {
    const logger = createLogger({ service: "test-service", level: "debug" });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
  });

  it("respects the level option", () => {
    const logger = createLogger({ service: "test", level: "error" });
    expect(logger.level).toBe("error");
  });

  it("defaults to 'info' level when no level specified", () => {
    Reflect.deleteProperty(process.env, "LOG_LEVEL");
    const logger = createLogger("test");
    expect(logger.level).toBe("info");
  });

  it("uses LOG_LEVEL env var when set", () => {
    process.env.LOG_LEVEL = "warn";
    const logger = createLogger("test");
    expect(logger.level).toBe("warn");
  });
});

describe("withContext", () => {
  it("creates a child logger with context fields", () => {
    const logger = createLogger({ service: "test", level: "info" });
    const child = withContext(logger, {
      requestId: "req_123",
      orgId: "org_456",
    });
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
  });
});

describe("withRequestId", () => {
  it("creates a child logger with requestId", () => {
    const logger = createLogger({ service: "test", level: "info" });
    const child = withRequestId(logger, "req_abc");
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
  });
});

describe("withTiming", () => {
  it("measures execution time and returns result", async () => {
    const logger = createLogger({ service: "test", level: "silent" });
    const result = await withTiming(logger, "test-op", () =>
      Promise.resolve(42)
    );
    expect(result).toBe(42);
  });

  it("re-throws errors from the timed function", async () => {
    const logger = createLogger({ service: "test", level: "silent" });
    await expect(
      withTiming(logger, "fail-op", () => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
  });
});
