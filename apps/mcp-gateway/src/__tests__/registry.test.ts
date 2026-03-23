import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { MCPToolDefinition, MCPToolHandler } from "../registry";
import { ToolRegistry } from "../registry";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  afterEach(() => {
    registry.stopHealthChecks();
  });

  it("registers and discovers tools", () => {
    const def: MCPToolDefinition = {
      name: "test_tool",
      description: "A test tool",
      adapter: "test",
      inputSchema: {},
      requiresAuth: false,
      category: "testing",
    };
    const handler: MCPToolHandler = vi.fn(async () => ({ success: true }));

    registry.register(def, handler);

    const tools = registry.discover();
    expect(tools.length).toBe(1);
    expect(tools[0]?.name).toBe("test_tool");
  });

  it("discovers tools by category", () => {
    const handler: MCPToolHandler = vi.fn(async () => ({ success: true }));

    registry.register(
      {
        name: "tool_a",
        description: "A",
        adapter: "test",
        inputSchema: {},
        requiresAuth: false,
        category: "cat_a",
      },
      handler
    );
    registry.register(
      {
        name: "tool_b",
        description: "B",
        adapter: "test",
        inputSchema: {},
        requiresAuth: false,
        category: "cat_b",
      },
      handler
    );

    const filtered = registry.discover("cat_a");
    expect(filtered.length).toBe(1);
    expect(filtered[0]?.name).toBe("tool_a");
  });

  it("registers adapter with multiple tools", () => {
    registry.registerAdapter({
      name: "github",
      tools: [
        {
          name: "github_clone",
          description: "Clone repo",
          adapter: "github",
          inputSchema: {},
          requiresAuth: true,
        },
        {
          name: "github_push",
          description: "Push code",
          adapter: "github",
          inputSchema: {},
          requiresAuth: true,
        },
      ],
      execute: vi.fn(async () => ({})),
    });

    const tools = registry.discover();
    expect(tools.length).toBe(2);
  });

  it("executes tool with context", async () => {
    const handler: MCPToolHandler = vi.fn(async () => ({
      success: true,
      data: "result",
    }));
    registry.register(
      {
        name: "exec_tool",
        description: "Exec",
        adapter: "test",
        inputSchema: {},
        requiresAuth: false,
      },
      handler
    );

    const result = await registry.execute(
      "exec_tool",
      { input: "data" },
      { orgId: "org_1" }
    );
    expect(handler).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("returns error for unknown tool", async () => {
    const result = await registry.execute(
      "nonexistent",
      {},
      { orgId: "org_1" }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns empty array when no tools registered", () => {
    expect(registry.discover()).toHaveLength(0);
  });

  it("returns all tools when no category filter", () => {
    const handler: MCPToolHandler = vi.fn(async () => ({ success: true }));
    registry.register(
      {
        name: "t1",
        description: "",
        adapter: "a",
        inputSchema: {},
        requiresAuth: false,
        category: "x",
      },
      handler
    );
    registry.register(
      {
        name: "t2",
        description: "",
        adapter: "b",
        inputSchema: {},
        requiresAuth: false,
        category: "y",
      },
      handler
    );
    expect(registry.discover()).toHaveLength(2);
  });

  // ---- New tests for Task 3.12/3.13 features ----

  it("unregisters a tool by name", () => {
    const handler: MCPToolHandler = vi.fn(async () => ({ success: true }));
    registry.register(
      {
        name: "to_remove",
        description: "Remove me",
        adapter: "test",
        inputSchema: {},
        requiresAuth: false,
      },
      handler
    );
    expect(registry.getToolCount()).toBe(1);

    const removed = registry.unregister("to_remove");
    expect(removed).toBe(true);
    expect(registry.getToolCount()).toBe(0);
  });

  it("unregisters all tools for an adapter", () => {
    const handler: MCPToolHandler = vi.fn(async () => ({ success: true }));
    registry.register(
      {
        name: "gh_1",
        description: "",
        adapter: "github",
        inputSchema: {},
        requiresAuth: false,
      },
      handler
    );
    registry.register(
      {
        name: "gh_2",
        description: "",
        adapter: "github",
        inputSchema: {},
        requiresAuth: false,
      },
      handler
    );
    registry.register(
      {
        name: "sl_1",
        description: "",
        adapter: "slack",
        inputSchema: {},
        requiresAuth: false,
      },
      handler
    );

    const removedCount = registry.unregisterAdapter("github");
    expect(removedCount).toBe(2);
    expect(registry.getToolCount()).toBe(1);
    expect(registry.getAdapters()).toEqual(["slack"]);
  });

  it("discovers tools grouped by adapter", () => {
    const handler: MCPToolHandler = vi.fn(async () => ({ success: true }));
    registry.register(
      {
        name: "gh_clone",
        description: "Clone",
        adapter: "github",
        inputSchema: {},
        requiresAuth: true,
      },
      handler
    );
    registry.register(
      {
        name: "gh_push",
        description: "Push",
        adapter: "github",
        inputSchema: {},
        requiresAuth: true,
      },
      handler
    );
    registry.register(
      {
        name: "sl_msg",
        description: "Message",
        adapter: "slack",
        inputSchema: {},
        requiresAuth: true,
      },
      handler
    );

    const grouped = registry.discoverGrouped();
    expect(Object.keys(grouped)).toEqual(["github", "slack"]);
    expect(grouped.github).toHaveLength(2);
    expect(grouped.slack).toHaveLength(1);
  });

  it("manages per-project tool configuration", () => {
    const handler: MCPToolHandler = vi.fn(async () => ({ success: true }));
    registry.register(
      {
        name: "tool_a",
        description: "A",
        adapter: "test",
        inputSchema: {},
        requiresAuth: false,
      },
      handler
    );
    registry.register(
      {
        name: "tool_b",
        description: "B",
        adapter: "test",
        inputSchema: {},
        requiresAuth: false,
      },
      handler
    );

    // Disable tool_b for project_1
    registry.setProjectToolConfig("project_1", "tool_b", false);

    const projectTools = registry.getProjectTools("project_1");
    expect(projectTools).toHaveLength(1);
    expect(projectTools[0]?.name).toBe("tool_a");

    const configs = registry.getProjectToolConfigs("project_1");
    expect(configs).toHaveLength(1);
    expect(configs[0]?.toolName).toBe("tool_b");
    expect(configs[0]?.enabled).toBe(false);
  });

  it("blocks execution of disabled project tools", async () => {
    const handler: MCPToolHandler = vi.fn(async () => ({
      success: true,
      data: "ok",
    }));
    registry.register(
      {
        name: "disabled_tool",
        description: "Disabled",
        adapter: "test",
        inputSchema: {},
        requiresAuth: false,
      },
      handler
    );

    registry.setProjectToolConfig("proj_1", "disabled_tool", false);

    const result = await registry.execute(
      "disabled_tool",
      {},
      { projectId: "proj_1" }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("disabled");
    expect(handler).not.toHaveBeenCalled();
  });

  it("tracks adapter health status", () => {
    registry.setAdapterHealth("github", true, 150);
    registry.setAdapterHealth("slack", false, 0, "Connection timeout");

    const statuses = registry.getHealthStatuses();
    expect(statuses).toHaveLength(2);

    const ghHealth = registry.getAdapterHealth("github");
    expect(ghHealth?.healthy).toBe(true);
    expect(ghHealth?.latencyMs).toBe(150);

    const slackHealth = registry.getAdapterHealth("slack");
    expect(slackHealth?.healthy).toBe(false);
    expect(slackHealth?.error).toBe("Connection timeout");
  });

  it("starts and stops health checks", () => {
    const handler: MCPToolHandler = vi.fn(async () => ({ success: true }));
    registry.register(
      {
        name: "t1",
        description: "",
        adapter: "github",
        inputSchema: {},
        requiresAuth: false,
      },
      handler
    );

    // Should not throw
    registry.startHealthChecks(60_000);
    registry.stopHealthChecks();
  });
});
