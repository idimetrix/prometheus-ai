import { describe, expect, it } from "vitest";
import {
  AgentAggressiveness,
  AgentMode,
  AgentRole,
  BlueprintEnforcement,
  CreditTransactionType,
  PlanTier,
  SessionEventType,
  SessionStatus,
  TaskStatus,
} from "../enums";

describe("AgentRole", () => {
  it("has all 13 specialist agent roles", () => {
    const roles = Object.values(AgentRole);
    expect(roles).toHaveLength(13);
    expect(roles).toContain("orchestrator");
    expect(roles).toContain("discovery");
    expect(roles).toContain("architect");
    expect(roles).toContain("planner");
    expect(roles).toContain("project_brain");
    expect(roles).toContain("frontend_coder");
    expect(roles).toContain("backend_coder");
    expect(roles).toContain("integration_coder");
    expect(roles).toContain("test_engineer");
    expect(roles).toContain("ci_loop");
    expect(roles).toContain("security_auditor");
    expect(roles).toContain("deploy_engineer");
    expect(roles).toContain("documentation_specialist");
  });

  it("has unique values for every key", () => {
    const values = Object.values(AgentRole);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("TaskStatus", () => {
  it("has all expected statuses", () => {
    expect(TaskStatus.PENDING).toBe("pending");
    expect(TaskStatus.QUEUED).toBe("queued");
    expect(TaskStatus.RUNNING).toBe("running");
    expect(TaskStatus.PAUSED).toBe("paused");
    expect(TaskStatus.COMPLETED).toBe("completed");
    expect(TaskStatus.FAILED).toBe("failed");
    expect(TaskStatus.CANCELLED).toBe("cancelled");
  });

  it("has 7 statuses", () => {
    expect(Object.values(TaskStatus)).toHaveLength(7);
  });
});

describe("SessionStatus", () => {
  it("has all expected statuses", () => {
    expect(SessionStatus.ACTIVE).toBe("active");
    expect(SessionStatus.PAUSED).toBe("paused");
    expect(SessionStatus.COMPLETED).toBe("completed");
    expect(SessionStatus.FAILED).toBe("failed");
    expect(SessionStatus.CANCELLED).toBe("cancelled");
  });

  it("has 5 statuses", () => {
    expect(Object.values(SessionStatus)).toHaveLength(5);
  });
});

describe("PlanTier", () => {
  it("has all 6 plan tiers", () => {
    expect(PlanTier.HOBBY).toBe("hobby");
    expect(PlanTier.STARTER).toBe("starter");
    expect(PlanTier.PRO).toBe("pro");
    expect(PlanTier.TEAM).toBe("team");
    expect(PlanTier.STUDIO).toBe("studio");
    expect(PlanTier.ENTERPRISE).toBe("enterprise");
  });
});

describe("AgentMode", () => {
  it("has all 5 modes", () => {
    expect(Object.values(AgentMode)).toHaveLength(5);
    expect(AgentMode.TASK).toBe("task");
    expect(AgentMode.ASK).toBe("ask");
    expect(AgentMode.PLAN).toBe("plan");
    expect(AgentMode.WATCH).toBe("watch");
    expect(AgentMode.FLEET).toBe("fleet");
  });
});

describe("CreditTransactionType", () => {
  it("has all transaction types", () => {
    expect(CreditTransactionType.PURCHASE).toBe("purchase");
    expect(CreditTransactionType.CONSUMPTION).toBe("consumption");
    expect(CreditTransactionType.REFUND).toBe("refund");
    expect(CreditTransactionType.BONUS).toBe("bonus");
    expect(CreditTransactionType.SUBSCRIPTION_GRANT).toBe("subscription_grant");
  });
});

describe("BlueprintEnforcement", () => {
  it("has all enforcement levels", () => {
    expect(BlueprintEnforcement.STRICT).toBe("strict");
    expect(BlueprintEnforcement.FLEXIBLE).toBe("flexible");
    expect(BlueprintEnforcement.ADVISORY).toBe("advisory");
  });
});

describe("AgentAggressiveness", () => {
  it("has all aggressiveness levels", () => {
    expect(AgentAggressiveness.BALANCED).toBe("balanced");
    expect(AgentAggressiveness.FULL_AUTO).toBe("full_auto");
    expect(AgentAggressiveness.SUPERVISED).toBe("supervised");
  });
});

describe("SessionEventType", () => {
  it("has all event types", () => {
    const values = Object.values(SessionEventType);
    expect(values).toContain("agent_output");
    expect(values).toContain("file_change");
    expect(values).toContain("plan_update");
    expect(values).toContain("task_status");
    expect(values).toContain("checkpoint");
    expect(values).toContain("error");
    expect(values).toContain("reasoning");
    expect(values).toContain("terminal_output");
    expect(values).toContain("pr_created");
  });

  it("has 12 event types", () => {
    expect(Object.values(SessionEventType)).toHaveLength(12);
  });
});
