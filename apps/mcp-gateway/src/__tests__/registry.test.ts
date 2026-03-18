import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { ToolRegistry } from "../registry";
import type { MCPToolDefinition, MCPToolHandler } from "../registry";

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
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
    expect(tools[0]!.name).toBe("test_tool");
  });

  it("discovers tools by category", () => {
    const handler: MCPToolHandler = vi.fn(async () => ({ success: true }));

    registry.register(
      { name: "tool_a", description: "A", adapter: "test", inputSchema: {}, requiresAuth: false, category: "cat_a" },
      handler,
    );
    registry.register(
      { name: "tool_b", description: "B", adapter: "test", inputSchema: {}, requiresAuth: false, category: "cat_b" },
      handler,
    );

    const filtered = registry.discover("cat_a");
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.name).toBe("tool_a");
  });

  it("registers adapter with multiple tools", () => {
    registry.registerAdapter({
      name: "github",
      tools: [
        { name: "github_clone", description: "Clone repo", adapter: "github", inputSchema: {}, requiresAuth: true },
        { name: "github_push", description: "Push code", adapter: "github", inputSchema: {}, requiresAuth: true },
      ],
      execute: vi.fn(async () => ({})),
    });

    const tools = registry.discover();
    expect(tools.length).toBe(2);
  });

  it("executes tool with context", async () => {
    const handler: MCPToolHandler = vi.fn(async () => ({ success: true, data: "result" }));
    registry.register(
      { name: "exec_tool", description: "Exec", adapter: "test", inputSchema: {}, requiresAuth: false },
      handler,
    );

    const result = await registry.execute("exec_tool", { input: "data" }, { orgId: "org_1" });
    expect(handler).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it("returns error for unknown tool", async () => {
    const result = await registry.execute("nonexistent", {}, { orgId: "org_1" }) as any;
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("returns empty array when no tools registered", () => {
    expect(registry.discover()).toHaveLength(0);
  });

  it("returns all tools when no category filter", () => {
    const handler: MCPToolHandler = vi.fn(async () => ({ success: true }));
    registry.register(
      { name: "t1", description: "", adapter: "a", inputSchema: {}, requiresAuth: false, category: "x" },
      handler,
    );
    registry.register(
      { name: "t2", description: "", adapter: "b", inputSchema: {}, requiresAuth: false, category: "y" },
      handler,
    );
    expect(registry.discover()).toHaveLength(2);
  });
});
