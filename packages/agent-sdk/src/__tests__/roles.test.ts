import { describe, it, expect } from "vitest";
import { AGENT_ROLES, getAgentConfig, createAgent } from "../roles";

describe("AGENT_ROLES", () => {
  it("should have 11 specialist roles", () => {
    expect(Object.keys(AGENT_ROLES)).toHaveLength(11);
  });

  it("should have all required roles", () => {
    const requiredRoles = [
      "orchestrator", "discovery", "architect", "planner",
      "frontend_coder", "backend_coder", "integration_coder",
      "test_engineer", "ci_loop", "security_auditor", "deploy_engineer",
    ];
    for (const role of requiredRoles) {
      expect(AGENT_ROLES).toHaveProperty(role);
    }
  });

  it("should have valid configs for each role", () => {
    for (const [_key, config] of Object.entries(AGENT_ROLES)) {
      expect(config.role).toBeTruthy();
      expect(config.displayName).toBeTruthy();
      expect(config.description).toBeTruthy();
      expect(config.preferredModel).toBeTruthy();
      expect(typeof config.create).toBe("function");
      expect(Array.isArray(config.tools)).toBe(true);
      expect(config.tools.length).toBeGreaterThan(0);
    }
  });

  it("should create agent instances", () => {
    for (const [_key, config] of Object.entries(AGENT_ROLES)) {
      const agent = config.create();
      expect(agent).toBeTruthy();
      expect(agent.getPreferredModel()).toBe(config.preferredModel);
    }
  });

  it("should give orchestrator spawn_agent and kill_agent tools", () => {
    const config = AGENT_ROLES.orchestrator;
    expect(config?.tools).toContain("spawn_agent");
    expect(config?.tools).toContain("kill_agent");
  });

  it("should give discovery agent ask_user tool", () => {
    const config = AGENT_ROLES.discovery;
    expect(config?.tools).toContain("ask_user");
  });

  it("should give ci_loop file_write and file_edit tools for the fix cycle", () => {
    const config = AGENT_ROLES.ci_loop;
    expect(config?.tools).toContain("file_write");
    expect(config?.tools).toContain("file_edit");
    expect(config?.tools).toContain("terminal_exec");
  });
});

describe("getAgentConfig", () => {
  it("should return config for valid role", () => {
    const config = getAgentConfig("orchestrator");
    expect(config).toBeTruthy();
    expect(config?.displayName).toBe("Orchestrator");
  });

  it("should return undefined for invalid role", () => {
    expect(getAgentConfig("nonexistent")).toBeUndefined();
  });
});

describe("createAgent", () => {
  it("should create an agent for a valid role", () => {
    const agent = createAgent("orchestrator");
    expect(agent).toBeTruthy();
    expect(agent.getPreferredModel()).toBe("ollama/qwen3.5:27b");
  });

  it("should throw for an invalid role", () => {
    expect(() => createAgent("nonexistent")).toThrow("Unknown agent role");
  });
});
