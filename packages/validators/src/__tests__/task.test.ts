import { describe, expect, it } from "vitest";
import {
  agentRoleSchema,
  cancelTaskSchema,
  costEstimateSchema,
  fleetDispatchSchema,
  getTaskSchema,
  listTasksSchema,
  submitTaskSchema,
  taskComplexitySchema,
  taskStatusSchema,
  updateTaskSchema,
} from "../task";

describe("taskStatusSchema", () => {
  const validStatuses = [
    "pending",
    "queued",
    "running",
    "paused",
    "completed",
    "failed",
    "cancelled",
  ];

  for (const status of validStatuses) {
    it(`accepts "${status}"`, () => {
      expect(taskStatusSchema.safeParse(status).success).toBe(true);
    });
  }

  it("rejects invalid status", () => {
    expect(taskStatusSchema.safeParse("unknown").success).toBe(false);
  });
});

describe("agentRoleSchema", () => {
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
      expect(agentRoleSchema.safeParse(role).success).toBe(true);
    });
  }

  it("rejects invalid role", () => {
    expect(agentRoleSchema.safeParse("manager").success).toBe(false);
  });
});

describe("taskComplexitySchema", () => {
  it("accepts valid complexities", () => {
    expect(taskComplexitySchema.safeParse("simple_fix").success).toBe(true);
    expect(taskComplexitySchema.safeParse("medium_task").success).toBe(true);
    expect(taskComplexitySchema.safeParse("complex_task").success).toBe(true);
  });

  it("rejects invalid complexity", () => {
    expect(taskComplexitySchema.safeParse("easy").success).toBe(false);
  });
});

describe("submitTaskSchema", () => {
  it("validates a valid task submission", () => {
    const result = submitTaskSchema.safeParse({
      sessionId: "ses_123",
      title: "Implement login",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe(5); // default
    }
  });

  it("requires sessionId", () => {
    expect(submitTaskSchema.safeParse({ title: "Test" }).success).toBe(false);
  });

  it("requires title", () => {
    expect(submitTaskSchema.safeParse({ sessionId: "ses_1" }).success).toBe(
      false
    );
  });

  it("rejects empty title", () => {
    expect(
      submitTaskSchema.safeParse({ sessionId: "ses_1", title: "" }).success
    ).toBe(false);
  });

  it("rejects title over 200 chars", () => {
    expect(
      submitTaskSchema.safeParse({
        sessionId: "ses_1",
        title: "x".repeat(201),
      }).success
    ).toBe(false);
  });

  it("accepts optional description", () => {
    const result = submitTaskSchema.safeParse({
      sessionId: "ses_1",
      title: "Task",
      description: "Detailed description",
    });
    expect(result.success).toBe(true);
  });

  it("rejects description over 5000 chars", () => {
    expect(
      submitTaskSchema.safeParse({
        sessionId: "ses_1",
        title: "Task",
        description: "x".repeat(5001),
      }).success
    ).toBe(false);
  });

  it("validates priority range 0-10", () => {
    expect(
      submitTaskSchema.safeParse({
        sessionId: "s",
        title: "t",
        priority: 0,
      }).success
    ).toBe(true);

    expect(
      submitTaskSchema.safeParse({
        sessionId: "s",
        title: "t",
        priority: 10,
      }).success
    ).toBe(true);

    expect(
      submitTaskSchema.safeParse({
        sessionId: "s",
        title: "t",
        priority: -1,
      }).success
    ).toBe(false);

    expect(
      submitTaskSchema.safeParse({
        sessionId: "s",
        title: "t",
        priority: 11,
      }).success
    ).toBe(false);
  });

  it("accepts optional agentRole", () => {
    const result = submitTaskSchema.safeParse({
      sessionId: "s",
      title: "t",
      agentRole: "backend_coder",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid agentRole", () => {
    expect(
      submitTaskSchema.safeParse({
        sessionId: "s",
        title: "t",
        agentRole: "invalid_role",
      }).success
    ).toBe(false);
  });
});

describe("updateTaskSchema", () => {
  it("requires taskId", () => {
    expect(updateTaskSchema.safeParse({}).success).toBe(false);
  });

  it("accepts taskId only (all fields optional)", () => {
    expect(updateTaskSchema.safeParse({ taskId: "tsk_1" }).success).toBe(true);
  });

  it("accepts partial updates", () => {
    const result = updateTaskSchema.safeParse({
      taskId: "tsk_1",
      status: "completed",
      priority: 8,
    });
    expect(result.success).toBe(true);
  });
});

describe("cancelTaskSchema", () => {
  it("requires taskId", () => {
    expect(cancelTaskSchema.safeParse({}).success).toBe(false);
  });

  it("accepts optional reason", () => {
    const result = cancelTaskSchema.safeParse({
      taskId: "tsk_1",
      reason: "No longer needed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects reason over 500 chars", () => {
    expect(
      cancelTaskSchema.safeParse({
        taskId: "tsk_1",
        reason: "x".repeat(501),
      }).success
    ).toBe(false);
  });
});

describe("fleetDispatchSchema", () => {
  it("validates valid fleet dispatch", () => {
    const result = fleetDispatchSchema.safeParse({
      sessionId: "ses_1",
      tasks: [{ title: "Task 1" }, { title: "Task 2" }],
    });
    expect(result.success).toBe(true);
  });

  it("requires at least one task", () => {
    expect(
      fleetDispatchSchema.safeParse({
        sessionId: "ses_1",
        tasks: [],
      }).success
    ).toBe(false);
  });

  it("rejects more than 10 tasks", () => {
    const tasks = Array.from({ length: 11 }, (_, i) => ({
      title: `Task ${i}`,
    }));
    expect(
      fleetDispatchSchema.safeParse({
        sessionId: "ses_1",
        tasks,
      }).success
    ).toBe(false);
  });

  it("validates task titles within fleet dispatch", () => {
    expect(
      fleetDispatchSchema.safeParse({
        sessionId: "ses_1",
        tasks: [{ title: "" }],
      }).success
    ).toBe(false);
  });
});

describe("costEstimateSchema", () => {
  it("validates valid cost estimate input", () => {
    const result = costEstimateSchema.safeParse({
      complexity: "simple_fix",
      mode: "task",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentCount).toBe(1); // default
    }
  });

  it("rejects invalid mode", () => {
    expect(
      costEstimateSchema.safeParse({
        complexity: "simple_fix",
        mode: "invalid",
      }).success
    ).toBe(false);
  });

  it("validates agentCount range 1-25", () => {
    expect(
      costEstimateSchema.safeParse({
        complexity: "medium_task",
        mode: "fleet",
        agentCount: 0,
      }).success
    ).toBe(false);

    expect(
      costEstimateSchema.safeParse({
        complexity: "medium_task",
        mode: "fleet",
        agentCount: 26,
      }).success
    ).toBe(false);

    expect(
      costEstimateSchema.safeParse({
        complexity: "medium_task",
        mode: "fleet",
        agentCount: 25,
      }).success
    ).toBe(true);
  });
});

describe("listTasksSchema", () => {
  it("validates with defaults", () => {
    const result = listTasksSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it("accepts all optional filters", () => {
    const result = listTasksSchema.safeParse({
      sessionId: "ses_1",
      projectId: "prj_1",
      status: "running",
      limit: 50,
      cursor: "abc",
    });
    expect(result.success).toBe(true);
  });

  it("rejects limit over 100", () => {
    expect(listTasksSchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe("getTaskSchema", () => {
  it("requires taskId", () => {
    expect(getTaskSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty taskId", () => {
    expect(getTaskSchema.safeParse({ taskId: "" }).success).toBe(false);
  });

  it("accepts valid taskId", () => {
    expect(getTaskSchema.safeParse({ taskId: "tsk_1" }).success).toBe(true);
  });
});
