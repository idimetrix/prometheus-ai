import { afterEach, describe, expect, it } from "vitest";
import type { Logger } from "../index";
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

  it("defaults to info level when no level specified", () => {
    Reflect.deleteProperty(process.env, "LOG_LEVEL");
    const logger = createLogger("test");
    expect(logger.level).toBe("info");
  });

  it("uses LOG_LEVEL env var when set", () => {
    process.env.LOG_LEVEL = "warn";
    const logger = createLogger("test");
    expect(logger.level).toBe("warn");
  });

  it("option level overrides LOG_LEVEL env var", () => {
    process.env.LOG_LEVEL = "warn";
    const logger = createLogger({ service: "test", level: "debug" });
    expect(logger.level).toBe("debug");
  });

  it("creates a logger with trace level", () => {
    const logger = createLogger({ service: "test", level: "trace" });
    expect(logger.level).toBe("trace");
    expect(typeof logger.trace).toBe("function");
  });

  it("creates a logger with silent level", () => {
    const logger = createLogger({ service: "test", level: "silent" });
    expect(logger.level).toBe("silent");
  });

  it("creates a logger with fatal level", () => {
    const logger = createLogger({ service: "test", level: "fatal" });
    expect(logger.level).toBe("fatal");
    expect(typeof logger.fatal).toBe("function");
  });

  it("creates a logger with defaultFields", () => {
    const logger = createLogger({
      service: "test",
      defaultFields: { env: "staging", version: "1.0" },
    });
    expect(logger).toBeDefined();
  });

  it("string name with explicit level parameter", () => {
    const logger = createLogger("my-service", "debug");
    expect(logger.level).toBe("debug");
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

  it("child logger retains parent capabilities", () => {
    const logger = createLogger({ service: "test", level: "info" });
    const child = withContext(logger, { userId: "user_1" });
    expect(typeof child.error).toBe("function");
    expect(typeof child.warn).toBe("function");
    expect(typeof child.debug).toBe("function");
  });

  it("accepts all known context fields", () => {
    const logger = createLogger({ service: "test", level: "info" });
    const child = withContext(logger, {
      requestId: "req_1",
      userId: "user_1",
      orgId: "org_1",
      sessionId: "ses_1",
      taskId: "task_1",
    });
    expect(child).toBeDefined();
  });

  it("accepts custom context fields", () => {
    const logger = createLogger({ service: "test", level: "info" });
    const child = withContext(logger, {
      customField: "custom_value",
      anotherField: 42,
    });
    expect(child).toBeDefined();
  });
});

describe("withRequestId", () => {
  it("creates a child logger with requestId", () => {
    const logger = createLogger({ service: "test", level: "info" });
    const child = withRequestId(logger, "req_abc");
    expect(child).toBeDefined();
    expect(typeof child.info).toBe("function");
  });

  it("child logger can create further children", () => {
    const logger = createLogger({ service: "test", level: "info" });
    const child = withRequestId(logger, "req_1");
    const grandchild = withContext(child, { orgId: "org_1" });
    expect(grandchild).toBeDefined();
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

  it("returns the correct value from async function", async () => {
    const logger = createLogger({ service: "test", level: "silent" });
    const result = await withTiming(logger, "fetch-data", async () => {
      await Promise.resolve();
      return { name: "test", value: 123 };
    });
    expect(result).toEqual({ name: "test", value: 123 });
  });

  it("re-throws errors from the timed function", async () => {
    const logger = createLogger({ service: "test", level: "silent" });
    await expect(
      withTiming(logger, "fail-op", () => Promise.reject(new Error("boom")))
    ).rejects.toThrow("boom");
  });

  it("works with void-returning async functions", async () => {
    const logger = createLogger({ service: "test", level: "silent" });
    const result = await withTiming(logger, "void-op", async () => {
      // side effect only
    });
    expect(result).toBeUndefined();
  });

  it("handles fast operations", async () => {
    const logger = createLogger({ service: "test", level: "silent" });
    const result = await withTiming(logger, "fast-op", () =>
      Promise.resolve("fast")
    );
    expect(result).toBe("fast");
  });

  it("handles slow operations", async () => {
    const logger = createLogger({ service: "test", level: "silent" });
    const result = await withTiming(logger, "slow-op", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "done";
    });
    expect(result).toBe("done");
  });
});

describe("Logger type", () => {
  it("Logger type is compatible with pino methods", () => {
    const logger: Logger = createLogger("type-test");
    // Verify the core logging methods exist
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.trace).toBe("function");
    expect(typeof logger.fatal).toBe("function");
    expect(typeof logger.child).toBe("function");
  });
});
