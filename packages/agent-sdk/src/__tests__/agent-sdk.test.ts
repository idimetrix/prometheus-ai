import { describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import { type AgentContext, resolveTools } from "../base-agent";
import { AGENT_ROLES, createAgent, getAgentConfig } from "../roles";
import { globalRegistry, TOOL_REGISTRY, ToolRegistry } from "../tools/registry";
import { type AgentToolDefinition, defineTool } from "../tools/types";

// ── AGENT_ROLES Tests ────────────────────────────────────────────────────────

describe("AGENT_ROLES", () => {
  const expectedRoles = [
    "orchestrator",
    "discovery",
    "architect",
    "planner",
    "frontend_coder",
    "backend_coder",
    "integration_coder",
    "test_engineer",
    "ci_loop",
    "security_auditor",
    "deploy_engineer",
    "documentation_specialist",
  ];

  it("defines all 12 agent roles", () => {
    expect(Object.keys(AGENT_ROLES)).toHaveLength(12);
  });

  it("contains all expected roles", () => {
    for (const role of expectedRoles) {
      expect(AGENT_ROLES[role]).toBeDefined();
    }
  });

  it("each role has required fields", () => {
    for (const [key, config] of Object.entries(AGENT_ROLES)) {
      expect(config.role).toBe(key);
      expect(config.displayName).toBeTruthy();
      expect(config.description).toBeTruthy();
      expect(config.preferredModel).toBeTruthy();
      expect(Array.isArray(config.tools)).toBe(true);
      expect(typeof config.create).toBe("function");
    }
  });

  it("orchestrator has spawn_agent and kill_agent tools", () => {
    const orchestrator = AGENT_ROLES.orchestrator;
    expect(orchestrator?.tools).toContain("spawn_agent");
    expect(orchestrator?.tools).toContain("kill_agent");
  });

  it("backend_coder has file and terminal tools", () => {
    const backend = AGENT_ROLES.backend_coder;
    expect(backend?.tools).toContain("file_read");
    expect(backend?.tools).toContain("file_write");
    expect(backend?.tools).toContain("terminal_exec");
  });

  it("frontend_coder has browser_open tool", () => {
    const frontend = AGENT_ROLES.frontend_coder;
    expect(frontend?.tools).toContain("browser_open");
  });

  it("ci_loop has terminal_exec and file_edit tools", () => {
    const ciLoop = AGENT_ROLES.ci_loop;
    expect(ciLoop?.tools).toContain("terminal_exec");
    expect(ciLoop?.tools).toContain("file_edit");
  });

  it("each role has a preferredModel in provider/model format", () => {
    for (const config of Object.values(AGENT_ROLES)) {
      expect(config.preferredModel).toContain("/");
    }
  });
});

describe("getAgentConfig", () => {
  it("returns config for valid role", () => {
    const config = getAgentConfig("orchestrator");
    expect(config).toBeDefined();
    expect(config?.role).toBe("orchestrator");
  });

  it("returns undefined for unknown role", () => {
    expect(getAgentConfig("nonexistent")).toBeUndefined();
  });
});

describe("createAgent", () => {
  it("creates an agent for a valid role", () => {
    const agent = createAgent("orchestrator");
    expect(agent).toBeDefined();
    expect(agent.getRole()).toBe("orchestrator");
  });

  it("throws for unknown role", () => {
    expect(() => createAgent("nonexistent")).toThrow("Unknown agent role");
  });

  it("creates different agent types for different roles", () => {
    const orchestrator = createAgent("orchestrator");
    const architect = createAgent("architect");
    expect(orchestrator.constructor.name).not.toBe(architect.constructor.name);
  });
});

// ── TOOL_REGISTRY Tests ──────────────────────────────────────────────────────

describe("TOOL_REGISTRY", () => {
  it("contains registered tools", () => {
    expect(Object.keys(TOOL_REGISTRY).length).toBeGreaterThan(0);
  });

  it("each tool has required fields", () => {
    for (const [name, tool] of Object.entries(TOOL_REGISTRY)) {
      expect(tool.name).toBe(name);
      expect(tool.description).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
      expect(typeof tool.creditCost).toBe("number");
      expect(tool.permissionLevel).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
  });

  it("contains file tools", () => {
    expect(TOOL_REGISTRY.file_read).toBeDefined();
    expect(TOOL_REGISTRY.file_write).toBeDefined();
    expect(TOOL_REGISTRY.file_edit).toBeDefined();
    expect(TOOL_REGISTRY.file_list).toBeDefined();
    expect(TOOL_REGISTRY.file_delete).toBeDefined();
  });

  it("contains terminal tools", () => {
    expect(TOOL_REGISTRY.terminal_exec).toBeDefined();
  });

  it("contains git tools", () => {
    expect(TOOL_REGISTRY.git_status).toBeDefined();
    expect(TOOL_REGISTRY.git_diff).toBeDefined();
    expect(TOOL_REGISTRY.git_commit).toBeDefined();
  });

  it("contains search tools", () => {
    expect(TOOL_REGISTRY.search_files).toBeDefined();
    expect(TOOL_REGISTRY.search_content).toBeDefined();
  });

  it("contains agent meta tools", () => {
    expect(TOOL_REGISTRY.spawn_agent).toBeDefined();
    expect(TOOL_REGISTRY.kill_agent).toBeDefined();
    expect(TOOL_REGISTRY.ask_user).toBeDefined();
  });

  it("file_read has read permission level", () => {
    expect(TOOL_REGISTRY.file_read?.permissionLevel).toBe("read");
  });

  it("file_write has write permission level", () => {
    expect(TOOL_REGISTRY.file_write?.permissionLevel).toBe("write");
  });

  it("terminal_exec has execute permission level", () => {
    expect(TOOL_REGISTRY.terminal_exec?.permissionLevel).toBe("execute");
  });
});

// ── ToolRegistry class Tests ─────────────────────────────────────────────────

describe("ToolRegistry class", () => {
  it("creates an empty registry", () => {
    const registry = new ToolRegistry();
    expect(registry.size).toBe(0);
  });

  it("creates a registry with initial tools", () => {
    const mockTool: AgentToolDefinition = {
      name: "test_tool",
      description: "A test tool",
      creditCost: 1,
      permissionLevel: "read",
      inputSchema: { type: "object", properties: {} },
      zodSchema: {} as never,
      execute: vi.fn().mockResolvedValue({ success: true, output: "ok" }),
    };
    const registry = new ToolRegistry([mockTool]);
    expect(registry.size).toBe(1);
  });

  it("register adds a tool", () => {
    const registry = new ToolRegistry();
    const mockTool: AgentToolDefinition = {
      name: "my_tool",
      description: "My tool",
      creditCost: 0,
      permissionLevel: "read",
      inputSchema: { type: "object" },
      zodSchema: {} as never,
      execute: vi.fn().mockResolvedValue({ success: true, output: "" }),
    };
    registry.register(mockTool);
    expect(registry.size).toBe(1);
    expect(registry.resolve("my_tool")).toBe(mockTool);
  });

  it("resolve returns undefined for unknown tools", () => {
    const registry = new ToolRegistry();
    expect(registry.resolve("nonexistent")).toBeUndefined();
  });

  it("resolveMany returns matching tools and skips unknowns", () => {
    const tool1: AgentToolDefinition = {
      name: "tool1",
      description: "Tool 1",
      creditCost: 0,
      permissionLevel: "read",
      inputSchema: {},
      zodSchema: {} as never,
      execute: vi.fn().mockResolvedValue({ success: true, output: "" }),
    };
    const registry = new ToolRegistry([tool1]);
    const resolved = registry.resolveMany(["tool1", "unknown"]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.name).toBe("tool1");
  });

  it("getNames returns all tool names", () => {
    const tool1: AgentToolDefinition = {
      name: "alpha",
      description: "Alpha",
      creditCost: 0,
      permissionLevel: "read",
      inputSchema: {},
      zodSchema: {} as never,
      execute: vi.fn().mockResolvedValue({ success: true, output: "" }),
    };
    const tool2: AgentToolDefinition = {
      name: "beta",
      description: "Beta",
      creditCost: 0,
      permissionLevel: "write",
      inputSchema: {},
      zodSchema: {} as never,
      execute: vi.fn().mockResolvedValue({ success: true, output: "" }),
    };
    const registry = new ToolRegistry([tool1, tool2]);
    expect(registry.getNames()).toEqual(["alpha", "beta"]);
  });

  it("getOpenAIToolDefs formats tools for OpenAI function calling", () => {
    const tool: AgentToolDefinition = {
      name: "search",
      description: "Search things",
      creditCost: 1,
      permissionLevel: "read",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
      zodSchema: {} as never,
      execute: vi.fn().mockResolvedValue({ success: true, output: "" }),
    };
    const registry = new ToolRegistry([tool]);
    const defs = registry.getOpenAIToolDefs();
    expect(defs).toHaveLength(1);
    expect(defs[0]?.type).toBe("function");
    expect(defs[0]?.function.name).toBe("search");
    expect(defs[0]?.function.description).toBe("Search things");
  });

  it("scoped creates a subset registry", () => {
    const tool1: AgentToolDefinition = {
      name: "a",
      description: "A",
      creditCost: 0,
      permissionLevel: "read",
      inputSchema: {},
      zodSchema: {} as never,
      execute: vi.fn().mockResolvedValue({ success: true, output: "" }),
    };
    const tool2: AgentToolDefinition = {
      name: "b",
      description: "B",
      creditCost: 0,
      permissionLevel: "write",
      inputSchema: {},
      zodSchema: {} as never,
      execute: vi.fn().mockResolvedValue({ success: true, output: "" }),
    };
    const registry = new ToolRegistry([tool1, tool2]);
    const scoped = registry.scoped(["a"]);
    expect(scoped.size).toBe(1);
    expect(scoped.resolve("a")).toBeDefined();
    expect(scoped.resolve("b")).toBeUndefined();
  });

  it("execute returns error for unknown tool", async () => {
    const registry = new ToolRegistry();
    const result = await registry.execute(
      "nope",
      {},
      {
        projectId: "p1",
        sandboxId: "s1",
        sessionId: "ses1",
        workDir: "/tmp",
      }
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown tool");
  });
});

describe("globalRegistry", () => {
  it("is pre-populated with built-in tools", () => {
    expect(globalRegistry.size).toBeGreaterThan(0);
  });

  it("can resolve file_read from global registry", () => {
    expect(globalRegistry.resolve("file_read")).toBeDefined();
  });
});

// ── defineTool Tests ─────────────────────────────────────────────────────────

describe("defineTool", () => {
  it("returns the same definition passed in", () => {
    const def: AgentToolDefinition = {
      name: "my_custom_tool",
      description: "Does custom things",
      creditCost: 2,
      permissionLevel: "write",
      inputSchema: { type: "object" },
      zodSchema: {} as never,
      execute: vi.fn().mockResolvedValue({ success: true, output: "done" }),
    };
    const result = defineTool(def);
    expect(result).toBe(def);
  });
});

// ── resolveTools Tests ───────────────────────────────────────────────────────

describe("resolveTools", () => {
  it("resolves known tool names from TOOL_REGISTRY", () => {
    const tools = resolveTools(["file_read", "file_write"]);
    expect(tools.length).toBe(2);
    expect(tools[0]?.name).toBe("file_read");
    expect(tools[1]?.name).toBe("file_write");
  });

  it("skips unknown tool names", () => {
    const tools = resolveTools(["file_read", "nonexistent_tool"]);
    expect(tools.length).toBe(1);
  });

  it("returns empty array for no matches", () => {
    const tools = resolveTools(["unknown1", "unknown2"]);
    expect(tools).toHaveLength(0);
  });
});

// ── BaseAgent Tests ──────────────────────────────────────────────────────────

describe("BaseAgent (via createAgent)", () => {
  it("agent has getRole method", () => {
    const agent = createAgent("architect");
    expect(agent.getRole()).toBe("architect");
  });

  it("agent starts with null context", () => {
    const agent = createAgent("planner");
    expect(agent.getContext()).toBeNull();
  });

  it("initialize sets context and builds system prompt", () => {
    const agent = createAgent("orchestrator");
    const ctx: AgentContext = {
      agentRole: "orchestrator",
      orgId: "org_1",
      projectId: "proj_1",
      sessionId: "ses_1",
      userId: "user_1",
      blueprintContent: null,
      projectContext: null,
    };
    agent.initialize(ctx);
    expect(agent.getContext()).toBe(ctx);
    const messages = agent.getMessages();
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0]?.role).toBe("system");
  });

  it("addUserMessage appends user message", () => {
    const agent = createAgent("discovery");
    agent.initialize({
      agentRole: "discovery",
      orgId: "org_1",
      projectId: "proj_1",
      sessionId: "ses_1",
      userId: "user_1",
      blueprintContent: null,
      projectContext: null,
    });
    agent.addUserMessage("What should we build?");
    const messages = agent.getMessages();
    const last = messages.at(-1);
    expect(last?.role).toBe("user");
    expect(last?.content).toBe("What should we build?");
  });

  it("addAssistantMessage appends assistant message", () => {
    const agent = createAgent("architect");
    agent.initialize({
      agentRole: "architect",
      orgId: "org_1",
      projectId: "proj_1",
      sessionId: "ses_1",
      userId: "user_1",
      blueprintContent: null,
      projectContext: null,
    });
    agent.addAssistantMessage("Here is the plan", [
      { id: "tc_1", name: "file_read", arguments: '{"path": "/src"}' },
    ]);
    const messages = agent.getMessages();
    const last = messages.at(-1);
    expect(last?.role).toBe("assistant");
    expect(last?.toolCalls).toHaveLength(1);
  });

  it("addToolResult appends tool result message", () => {
    const agent = createAgent("backend_coder");
    agent.initialize({
      agentRole: "backend_coder",
      orgId: "org_1",
      projectId: "proj_1",
      sessionId: "ses_1",
      userId: "user_1",
      blueprintContent: null,
      projectContext: null,
    });
    agent.addToolResult("tc_1", "File contents here");
    const messages = agent.getMessages();
    const last = messages.at(-1);
    expect(last?.role).toBe("tool");
    expect(last?.toolCallId).toBe("tc_1");
  });

  it("getToolDefinitions returns OpenAI-formatted tool defs", () => {
    const agent = createAgent("orchestrator");
    const defs = agent.getToolDefinitions();
    expect(Array.isArray(defs)).toBe(true);
  });

  it("setEventPublisher sets the publisher", () => {
    const agent = createAgent("orchestrator");
    const mockPublisher = {
      publishSessionEvent: vi.fn(),
    };
    agent.setEventPublisher(mockPublisher);
    // No error means it worked
    expect(true).toBe(true);
  });

  it("initialize restores memory if provided", () => {
    const agent = createAgent("planner");
    agent.initialize({
      agentRole: "planner",
      orgId: "org_1",
      projectId: "proj_1",
      sessionId: "ses_1",
      userId: "user_1",
      blueprintContent: null,
      projectContext: null,
      memory: [
        { role: "user", content: "Previous message" },
        { role: "assistant", content: "Previous reply" },
      ],
    });
    const messages = agent.getMessages();
    // Should have system + 2 memory messages
    expect(messages.length).toBe(3);
  });
});
