import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type {
  MCPAdapter,
  MCPToolDefinition,
  MCPToolHandler,
} from "../registry";
import { ToolRegistry } from "../registry";

function makeToolDef(
  overrides?: Partial<MCPToolDefinition>
): MCPToolDefinition {
  return {
    name: "test_tool",
    description: "A test tool",
    adapter: "test",
    inputSchema: {},
    requiresAuth: false,
    ...overrides,
  };
}

function makeHandler(result?: {
  success: boolean;
  data?: unknown;
  error?: string;
}): MCPToolHandler {
  return vi.fn(async () => result ?? { success: true, data: "ok" });
}

describe("ToolRegistry - extended coverage", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  afterEach(() => {
    registry.stopHealthChecks();
  });

  // ---- Auth checks ----

  describe("authentication enforcement", () => {
    it("returns error when tool requires auth and no credentials provided", async () => {
      registry.register(
        makeToolDef({ name: "auth_tool", requiresAuth: true }),
        makeHandler()
      );

      const result = await registry.execute("auth_tool", {}, { orgId: "o1" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("requires authentication");
    });

    it("executes when credentials are provided for auth-required tool", async () => {
      registry.register(
        makeToolDef({ name: "auth_tool", requiresAuth: true }),
        makeHandler()
      );

      const result = await registry.execute(
        "auth_tool",
        {},
        {
          orgId: "o1",
          credentials: { token: "abc" },
        }
      );
      expect(result.success).toBe(true);
    });

    it("executes without credentials for non-auth tool", async () => {
      registry.register(
        makeToolDef({ name: "public_tool", requiresAuth: false }),
        makeHandler()
      );

      const result = await registry.execute("public_tool", {}, { orgId: "o1" });
      expect(result.success).toBe(true);
    });
  });

  // ---- Audit log ----

  describe("audit logging", () => {
    it("records successful executions in audit log", async () => {
      registry.register(makeToolDef({ name: "audit_tool" }), makeHandler());

      await registry.execute("audit_tool", {}, { orgId: "org_1" });

      const log = registry.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0]?.toolName).toBe("audit_tool");
      expect(log[0]?.success).toBe(true);
      expect(log[0]?.orgId).toBe("org_1");
    });

    it("records failed executions in audit log", async () => {
      const result = await registry.execute("nonexistent", {}, { orgId: "o1" });
      expect(result.success).toBe(false);

      // Tool not found does not go through audit log (returns early)
      // But handler failures do
      const failHandler: MCPToolHandler = vi.fn(() => {
        return Promise.reject(new Error("handler error"));
      });
      registry.register(makeToolDef({ name: "fail_tool" }), failHandler);
      await registry.execute("fail_tool", {}, { orgId: "o1" });

      const log = registry.getAuditLog();
      expect(log.some((e) => !e.success)).toBe(true);
    });

    it("respects audit log limit parameter", async () => {
      registry.register(makeToolDef({ name: "many" }), makeHandler());

      for (let i = 0; i < 5; i++) {
        await registry.execute("many", {}, { orgId: "o1" });
      }

      const limited = registry.getAuditLog(2);
      expect(limited).toHaveLength(2);

      const all = registry.getAuditLog(10);
      expect(all).toHaveLength(5);
    });
  });

  // ---- Tool listing helpers ----

  describe("tool listing", () => {
    it("listTools returns all registered tool definitions", () => {
      registry.register(
        makeToolDef({ name: "t1", adapter: "a" }),
        makeHandler()
      );
      registry.register(
        makeToolDef({ name: "t2", adapter: "b" }),
        makeHandler()
      );

      const tools = registry.listTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toContain("t1");
      expect(tools.map((t) => t.name)).toContain("t2");
    });

    it("listToolsByAdapter filters correctly", () => {
      registry.register(
        makeToolDef({ name: "t1", adapter: "github" }),
        makeHandler()
      );
      registry.register(
        makeToolDef({ name: "t2", adapter: "github" }),
        makeHandler()
      );
      registry.register(
        makeToolDef({ name: "t3", adapter: "slack" }),
        makeHandler()
      );

      expect(registry.listToolsByAdapter("github")).toHaveLength(2);
      expect(registry.listToolsByAdapter("slack")).toHaveLength(1);
      expect(registry.listToolsByAdapter("unknown")).toHaveLength(0);
    });

    it("getTool returns undefined for unregistered tool", () => {
      expect(registry.getTool("nonexistent")).toBeUndefined();
    });

    it("getTool returns definition for registered tool", () => {
      registry.register(makeToolDef({ name: "my_tool" }), makeHandler());
      const tool = registry.getTool("my_tool");
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("my_tool");
    });

    it("getAdapters returns unique adapter names", () => {
      registry.register(
        makeToolDef({ name: "t1", adapter: "github" }),
        makeHandler()
      );
      registry.register(
        makeToolDef({ name: "t2", adapter: "github" }),
        makeHandler()
      );
      registry.register(
        makeToolDef({ name: "t3", adapter: "slack" }),
        makeHandler()
      );

      const adapters = registry.getAdapters();
      expect(adapters).toHaveLength(2);
      expect(adapters).toContain("github");
      expect(adapters).toContain("slack");
    });
  });

  // ---- Adapter registration ----

  describe("registerAdapter", () => {
    it("registers all tools from adapter and passes credentials to execute", async () => {
      const executeFn = vi.fn(async () => ({ result: "done" }));
      const adapter: MCPAdapter = {
        name: "jira",
        tools: [
          makeToolDef({
            name: "jira_create",
            adapter: "jira",
            requiresAuth: true,
          }),
          makeToolDef({
            name: "jira_list",
            adapter: "jira",
            requiresAuth: false,
          }),
        ],
        execute: executeFn,
      };

      registry.registerAdapter(adapter);

      expect(registry.getToolCount()).toBe(2);
      expect(registry.getAdapters()).toContain("jira");

      // Execute should pass token from credentials
      const result = await registry.execute(
        "jira_create",
        { key: "val" },
        {
          credentials: { jira_token: "my-token" },
        }
      );
      expect(result.success).toBe(true);
      expect(executeFn).toHaveBeenCalledWith(
        "jira_create",
        { key: "val" },
        "my-token"
      );
    });
  });

  // ---- Legacy executeTool ----

  describe("executeTool (legacy)", () => {
    it("delegates to execute", async () => {
      registry.register(makeToolDef({ name: "legacy_tool" }), makeHandler());

      const result = await registry.executeTool("legacy_tool", { a: 1 });
      expect(result.success).toBe(true);
    });
  });

  // ---- Overwrite warning ----

  describe("tool overwriting", () => {
    it("overwrites existing tool with same name", () => {
      const handler1 = makeHandler({ success: true, data: "first" });
      const handler2 = makeHandler({ success: true, data: "second" });

      registry.register(makeToolDef({ name: "dup" }), handler1);
      registry.register(makeToolDef({ name: "dup" }), handler2);

      expect(registry.getToolCount()).toBe(1);
    });
  });

  // ---- Unregister edge cases ----

  describe("unregister edge cases", () => {
    it("returns false when unregistering nonexistent tool", () => {
      expect(registry.unregister("ghost")).toBe(false);
    });

    it("returns 0 when unregistering nonexistent adapter", () => {
      expect(registry.unregisterAdapter("ghost")).toBe(0);
    });
  });

  // ---- Project tool configs edge cases ----

  describe("project tool configs", () => {
    it("returns all tools when no project config exists", () => {
      registry.register(makeToolDef({ name: "t1" }), makeHandler());
      registry.register(makeToolDef({ name: "t2" }), makeHandler());

      const tools = registry.getProjectTools("unconfigured_project");
      expect(tools).toHaveLength(2);
    });

    it("returns empty configs for unconfigured project", () => {
      expect(registry.getProjectToolConfigs("unconfigured")).toEqual([]);
    });

    it("can re-enable a previously disabled tool", () => {
      registry.register(makeToolDef({ name: "toggle" }), makeHandler());

      registry.setProjectToolConfig("p1", "toggle", false);
      expect(registry.getProjectTools("p1")).toHaveLength(0);

      registry.setProjectToolConfig("p1", "toggle", true);
      expect(registry.getProjectTools("p1")).toHaveLength(1);
    });

    it("stores config metadata", () => {
      registry.register(makeToolDef({ name: "cfg_tool" }), makeHandler());
      registry.setProjectToolConfig("p1", "cfg_tool", true, { maxRetries: 3 });

      const configs = registry.getProjectToolConfigs("p1");
      expect(configs).toHaveLength(1);
      expect(configs[0]?.config).toEqual({ maxRetries: 3 });
    });
  });

  // ---- Health checks with custom check function ----

  describe("health checks with custom function", () => {
    it("calls custom check function and updates health status", async () => {
      registry.register(
        makeToolDef({ name: "gh_tool", adapter: "github" }),
        makeHandler()
      );

      const checkFn = vi.fn(async (adapter: string) => ({
        healthy: adapter === "github",
        latencyMs: 100,
      }));

      registry.startHealthChecks(60_000, checkFn);

      // Wait a tick for the initial check to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(checkFn).toHaveBeenCalledWith("github");

      const health = registry.getAdapterHealth("github");
      expect(health?.healthy).toBe(true);
      expect(health?.latencyMs).toBe(100);

      registry.stopHealthChecks();
    });

    it("marks adapter unhealthy when check function throws", async () => {
      registry.register(
        makeToolDef({ name: "bad_tool", adapter: "broken" }),
        makeHandler()
      );

      const checkFn = vi.fn(() => {
        return Promise.reject(new Error("check failed"));
      });

      registry.startHealthChecks(60_000, checkFn);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const health = registry.getAdapterHealth("broken");
      expect(health?.healthy).toBe(false);
      expect(health?.error).toBe("check failed");

      registry.stopHealthChecks();
    });
  });

  // ---- Handler error handling ----

  describe("handler errors", () => {
    it("catches handler errors and returns error result", async () => {
      const failHandler: MCPToolHandler = vi.fn(() => {
        return Promise.reject(new Error("tool crashed"));
      });
      registry.register(makeToolDef({ name: "crash_tool" }), failHandler);

      const result = await registry.execute("crash_tool", {}, { orgId: "o1" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("tool crashed");
    });
  });
});
