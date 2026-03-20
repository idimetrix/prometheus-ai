import { describe, expect, it } from "vitest";
import {
  agentConfigSchema,
  agentRoleEnum,
  agentStatusEnum,
  getAgentSchema,
  listAgentsSchema,
  reassignAgentSchema,
  selectAgentRoleSchema,
  terminateAgentSchema,
  updateAgentConfigSchema,
} from "../agent";

describe("agentRoleEnum", () => {
  const validRoles = [
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
    "project_brain",
  ];

  for (const role of validRoles) {
    it(`accepts "${role}"`, () => {
      expect(agentRoleEnum.safeParse(role).success).toBe(true);
    });
  }

  it("rejects invalid roles", () => {
    expect(agentRoleEnum.safeParse("").success).toBe(false);
    expect(agentRoleEnum.safeParse("manager").success).toBe(false);
    expect(agentRoleEnum.safeParse("ORCHESTRATOR").success).toBe(false);
  });
});

describe("agentStatusEnum", () => {
  it("accepts valid statuses", () => {
    expect(agentStatusEnum.safeParse("idle").success).toBe(true);
    expect(agentStatusEnum.safeParse("working").success).toBe(true);
    expect(agentStatusEnum.safeParse("error").success).toBe(true);
    expect(agentStatusEnum.safeParse("terminated").success).toBe(true);
  });

  it("rejects invalid statuses", () => {
    expect(agentStatusEnum.safeParse("running").success).toBe(false);
    expect(agentStatusEnum.safeParse("").success).toBe(false);
  });
});

describe("agentConfigSchema", () => {
  it("validates a complete agent config", () => {
    const result = agentConfigSchema.safeParse({
      role: "backend_coder",
      model: "gpt-4",
      systemPrompt: "You are a helpful coder.",
      tools: ["readFile", "writeFile"],
      maxTokens: 4096,
      temperature: 0.5,
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults for optional fields", () => {
    const result = agentConfigSchema.safeParse({
      role: "backend_coder",
      model: "gpt-4",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tools).toEqual([]);
      expect(result.data.maxTokens).toBe(8192);
      expect(result.data.temperature).toBe(0.7);
    }
  });

  it("requires role", () => {
    expect(agentConfigSchema.safeParse({ model: "gpt-4" }).success).toBe(false);
  });

  it("requires model", () => {
    expect(agentConfigSchema.safeParse({ role: "backend_coder" }).success).toBe(
      false
    );
  });

  it("rejects empty model", () => {
    expect(
      agentConfigSchema.safeParse({
        role: "backend_coder",
        model: "",
      }).success
    ).toBe(false);
  });

  it("rejects model over 100 chars", () => {
    expect(
      agentConfigSchema.safeParse({
        role: "backend_coder",
        model: "x".repeat(101),
      }).success
    ).toBe(false);
  });

  it("validates maxTokens range 256-200000", () => {
    expect(
      agentConfigSchema.safeParse({
        role: "backend_coder",
        model: "m",
        maxTokens: 255,
      }).success
    ).toBe(false);

    expect(
      agentConfigSchema.safeParse({
        role: "backend_coder",
        model: "m",
        maxTokens: 200_001,
      }).success
    ).toBe(false);

    expect(
      agentConfigSchema.safeParse({
        role: "backend_coder",
        model: "m",
        maxTokens: 256,
      }).success
    ).toBe(true);

    expect(
      agentConfigSchema.safeParse({
        role: "backend_coder",
        model: "m",
        maxTokens: 200_000,
      }).success
    ).toBe(true);
  });

  it("validates temperature range 0-2", () => {
    expect(
      agentConfigSchema.safeParse({
        role: "backend_coder",
        model: "m",
        temperature: -0.1,
      }).success
    ).toBe(false);

    expect(
      agentConfigSchema.safeParse({
        role: "backend_coder",
        model: "m",
        temperature: 2.1,
      }).success
    ).toBe(false);

    expect(
      agentConfigSchema.safeParse({
        role: "backend_coder",
        model: "m",
        temperature: 0,
      }).success
    ).toBe(true);

    expect(
      agentConfigSchema.safeParse({
        role: "backend_coder",
        model: "m",
        temperature: 2,
      }).success
    ).toBe(true);
  });

  it("validates systemPrompt max length", () => {
    expect(
      agentConfigSchema.safeParse({
        role: "backend_coder",
        model: "m",
        systemPrompt: "x".repeat(50_001),
      }).success
    ).toBe(false);

    expect(
      agentConfigSchema.safeParse({
        role: "backend_coder",
        model: "m",
        systemPrompt: "x".repeat(50_000),
      }).success
    ).toBe(true);
  });
});

describe("updateAgentConfigSchema", () => {
  it("requires role even though other fields are partial", () => {
    expect(updateAgentConfigSchema.safeParse({ model: "gpt-4" }).success).toBe(
      false
    );
  });

  it("accepts role with optional updates", () => {
    const result = updateAgentConfigSchema.safeParse({
      role: "test_engineer",
      temperature: 0.3,
    });
    expect(result.success).toBe(true);
  });
});

describe("selectAgentRoleSchema", () => {
  it("validates selection input", () => {
    const result = selectAgentRoleSchema.safeParse({
      sessionId: "ses_1",
      role: "architect",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional model", () => {
    const result = selectAgentRoleSchema.safeParse({
      sessionId: "ses_1",
      role: "architect",
      model: "claude-3",
    });
    expect(result.success).toBe(true);
  });

  it("requires sessionId", () => {
    expect(selectAgentRoleSchema.safeParse({ role: "architect" }).success).toBe(
      false
    );
  });
});

describe("terminateAgentSchema", () => {
  it("requires agentId", () => {
    expect(terminateAgentSchema.safeParse({}).success).toBe(false);
  });

  it("accepts optional reason", () => {
    expect(
      terminateAgentSchema.safeParse({
        agentId: "agt_1",
        reason: "Task complete",
      }).success
    ).toBe(true);
  });

  it("rejects reason over 500 chars", () => {
    expect(
      terminateAgentSchema.safeParse({
        agentId: "agt_1",
        reason: "x".repeat(501),
      }).success
    ).toBe(false);
  });
});

describe("reassignAgentSchema", () => {
  it("requires both agentId and taskId", () => {
    expect(reassignAgentSchema.safeParse({}).success).toBe(false);
    expect(reassignAgentSchema.safeParse({ agentId: "a1" }).success).toBe(
      false
    );
    expect(reassignAgentSchema.safeParse({ taskId: "t1" }).success).toBe(false);
  });

  it("validates valid reassignment", () => {
    expect(
      reassignAgentSchema.safeParse({
        agentId: "agt_1",
        taskId: "tsk_1",
      }).success
    ).toBe(true);
  });
});

describe("listAgentsSchema", () => {
  it("validates with defaults", () => {
    const result = listAgentsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it("accepts all filters", () => {
    const result = listAgentsSchema.safeParse({
      sessionId: "ses_1",
      status: "working",
      role: "backend_coder",
      limit: 50,
    });
    expect(result.success).toBe(true);
  });

  it("rejects limit over 50", () => {
    expect(listAgentsSchema.safeParse({ limit: 51 }).success).toBe(false);
  });

  it("rejects limit under 1", () => {
    expect(listAgentsSchema.safeParse({ limit: 0 }).success).toBe(false);
  });
});

describe("getAgentSchema", () => {
  it("requires agentId", () => {
    expect(getAgentSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty agentId", () => {
    expect(getAgentSchema.safeParse({ agentId: "" }).success).toBe(false);
  });

  it("accepts valid agentId", () => {
    expect(getAgentSchema.safeParse({ agentId: "agt_1" }).success).toBe(true);
  });
});
