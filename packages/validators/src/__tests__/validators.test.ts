import { describe, expect, it } from "vitest";
import {
  createBlueprintSchema,
  getBlueprintSchema,
  updateBlueprintSchema,
} from "../blueprint";
import {
  addProjectMemberSchema,
  connectRepoSchema,
  createProjectSchema,
  listProjectsSchema,
  projectSettingsSchema,
  updateProjectSchema,
} from "../project";
import {
  approvePlanSchema,
  cancelSessionSchema,
  createSessionSchema,
  listSessionsSchema,
  sendMessageSchema,
  sessionEventSchema,
  sessionModeSchema,
  sessionStatusSchema,
  updateSessionSchema,
} from "../session";
import {
  agentRoleSchema,
  cancelTaskSchema,
  costEstimateSchema,
  fleetDispatchSchema,
  submitTaskSchema,
  taskComplexitySchema,
  taskStatusSchema,
  updateTaskSchema,
} from "../task";

// ============================================================================
// Session schemas
// ============================================================================

describe("sessionModeSchema", () => {
  it("accepts all valid modes", () => {
    for (const mode of ["task", "ask", "plan", "watch", "fleet"]) {
      expect(sessionModeSchema.safeParse(mode).success).toBe(true);
    }
  });

  it("rejects invalid modes", () => {
    expect(sessionModeSchema.safeParse("invalid").success).toBe(false);
    expect(sessionModeSchema.safeParse("").success).toBe(false);
    expect(sessionModeSchema.safeParse(123).success).toBe(false);
  });
});

describe("sessionStatusSchema", () => {
  it("accepts all valid statuses", () => {
    for (const status of [
      "active",
      "paused",
      "completed",
      "failed",
      "cancelled",
    ]) {
      expect(sessionStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects invalid statuses", () => {
    expect(sessionStatusSchema.safeParse("running").success).toBe(false);
    expect(sessionStatusSchema.safeParse("stopped").success).toBe(false);
  });
});

describe("createSessionSchema", () => {
  it("validates a minimal valid session", () => {
    const result = createSessionSchema.safeParse({ projectId: "prj_123" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("task"); // default
    }
  });

  it("validates a session with all fields", () => {
    const result = createSessionSchema.safeParse({
      projectId: "prj_123",
      mode: "ask",
      prompt: "Build a REST API",
    });
    expect(result.success).toBe(true);
  });

  it("requires projectId", () => {
    expect(createSessionSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty projectId", () => {
    expect(createSessionSchema.safeParse({ projectId: "" }).success).toBe(
      false
    );
  });

  it("rejects invalid mode", () => {
    expect(
      createSessionSchema.safeParse({ projectId: "p", mode: "bad" }).success
    ).toBe(false);
  });

  it("rejects prompt exceeding 10000 characters", () => {
    expect(
      createSessionSchema.safeParse({
        projectId: "p",
        prompt: "x".repeat(10_001),
      }).success
    ).toBe(false);
  });

  it("allows prompt up to 10000 characters", () => {
    expect(
      createSessionSchema.safeParse({
        projectId: "p",
        prompt: "x".repeat(10_000),
      }).success
    ).toBe(true);
  });
});

describe("updateSessionSchema", () => {
  it("validates with sessionId only", () => {
    const result = updateSessionSchema.safeParse({ sessionId: "ses_123" });
    expect(result.success).toBe(true);
  });

  it("validates with status and mode", () => {
    const result = updateSessionSchema.safeParse({
      sessionId: "ses_123",
      status: "paused",
      mode: "plan",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty sessionId", () => {
    expect(updateSessionSchema.safeParse({ sessionId: "" }).success).toBe(
      false
    );
  });

  it("rejects invalid status", () => {
    expect(
      updateSessionSchema.safeParse({
        sessionId: "ses_123",
        status: "invalid",
      }).success
    ).toBe(false);
  });
});

describe("sendMessageSchema", () => {
  it("validates a valid message", () => {
    const result = sendMessageSchema.safeParse({
      sessionId: "ses_123",
      content: "Hello",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty content", () => {
    expect(
      sendMessageSchema.safeParse({ sessionId: "ses_123", content: "" }).success
    ).toBe(false);
  });

  it("rejects content exceeding 10000 characters", () => {
    expect(
      sendMessageSchema.safeParse({
        sessionId: "ses_123",
        content: "x".repeat(10_001),
      }).success
    ).toBe(false);
  });
});

describe("approvePlanSchema", () => {
  it("validates with defaults", () => {
    const result = approvePlanSchema.safeParse({ sessionId: "ses_123" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.approved).toBe(true); // default
    }
  });

  it("accepts optional feedback", () => {
    const result = approvePlanSchema.safeParse({
      sessionId: "ses_123",
      approved: false,
      feedback: "Please change the approach",
    });
    expect(result.success).toBe(true);
  });

  it("rejects feedback exceeding 2000 characters", () => {
    expect(
      approvePlanSchema.safeParse({
        sessionId: "ses_123",
        feedback: "x".repeat(2001),
      }).success
    ).toBe(false);
  });
});

describe("cancelSessionSchema", () => {
  it("validates with sessionId only", () => {
    expect(
      cancelSessionSchema.safeParse({ sessionId: "ses_123" }).success
    ).toBe(true);
  });

  it("accepts optional reason", () => {
    expect(
      cancelSessionSchema.safeParse({
        sessionId: "ses_123",
        reason: "No longer needed",
      }).success
    ).toBe(true);
  });

  it("rejects reason exceeding 500 characters", () => {
    expect(
      cancelSessionSchema.safeParse({
        sessionId: "ses_123",
        reason: "x".repeat(501),
      }).success
    ).toBe(false);
  });
});

describe("sessionEventSchema", () => {
  it("validates a valid event", () => {
    const result = sessionEventSchema.safeParse({
      type: "agent_output",
      data: { content: "hello" },
      timestamp: "2025-01-01T00:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid event type", () => {
    expect(
      sessionEventSchema.safeParse({
        type: "invalid_type",
        data: {},
        timestamp: "2025-01-01T00:00:00.000Z",
      }).success
    ).toBe(false);
  });

  it("rejects invalid timestamp format", () => {
    expect(
      sessionEventSchema.safeParse({
        type: "error",
        data: {},
        timestamp: "not-a-date",
      }).success
    ).toBe(false);
  });

  it("accepts all valid event types", () => {
    const types = [
      "agent_output",
      "file_change",
      "plan_update",
      "task_status",
      "queue_position",
      "credit_update",
      "checkpoint",
      "error",
      "reasoning",
      "terminal_output",
      "browser_screenshot",
      "pr_created",
    ];
    for (const type of types) {
      const result = sessionEventSchema.safeParse({
        type,
        data: {},
        timestamp: "2025-01-01T00:00:00.000Z",
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("listSessionsSchema", () => {
  it("applies defaults", () => {
    const result = listSessionsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it("rejects limit below 1", () => {
    expect(listSessionsSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it("rejects limit above 100", () => {
    expect(listSessionsSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("accepts all optional filters", () => {
    const result = listSessionsSchema.safeParse({
      projectId: "prj_123",
      status: "active",
      mode: "task",
      limit: 50,
      cursor: "abc",
    });
    expect(result.success).toBe(true);
  });
});

// ============================================================================
// Project schemas
// ============================================================================

describe("createProjectSchema", () => {
  it("validates a minimal project", () => {
    const result = createProjectSchema.safeParse({ name: "My Project" });
    expect(result.success).toBe(true);
  });

  it("validates a project with all fields", () => {
    const result = createProjectSchema.safeParse({
      name: "My Project",
      description: "A test project",
      techStackPreset: "modern-saas",
      repoUrl: "https://github.com/org/repo",
    });
    expect(result.success).toBe(true);
  });

  it("requires name", () => {
    expect(createProjectSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(createProjectSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects name exceeding 100 characters", () => {
    expect(
      createProjectSchema.safeParse({ name: "x".repeat(101) }).success
    ).toBe(false);
  });

  it("accepts name at exactly 100 characters", () => {
    expect(
      createProjectSchema.safeParse({ name: "x".repeat(100) }).success
    ).toBe(true);
  });

  it("rejects description exceeding 1000 characters", () => {
    expect(
      createProjectSchema.safeParse({
        name: "Test",
        description: "x".repeat(1001),
      }).success
    ).toBe(false);
  });

  it("rejects invalid repo URL", () => {
    expect(
      createProjectSchema.safeParse({ name: "Test", repoUrl: "not-a-url" })
        .success
    ).toBe(false);
  });

  it("accepts valid repo URL", () => {
    expect(
      createProjectSchema.safeParse({
        name: "Test",
        repoUrl: "https://github.com/org/repo",
      }).success
    ).toBe(true);
  });
});

describe("updateProjectSchema", () => {
  it("allows all fields to be optional (partial of create)", () => {
    const result = updateProjectSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("validates partial updates", () => {
    const result = updateProjectSchema.safeParse({ name: "New Name" });
    expect(result.success).toBe(true);
  });

  it("still enforces constraints on provided fields", () => {
    expect(updateProjectSchema.safeParse({ name: "" }).success).toBe(false);
    expect(
      updateProjectSchema.safeParse({ repoUrl: "not-a-url" }).success
    ).toBe(false);
  });
});

describe("projectSettingsSchema", () => {
  it("applies all defaults", () => {
    const result = projectSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentAggressiveness).toBe("balanced");
      expect(result.data.ciLoopMaxIterations).toBe(20);
      expect(result.data.parallelAgentCount).toBe(1);
      expect(result.data.blueprintEnforcement).toBe("strict");
      expect(result.data.testCoverageTarget).toBe(80);
      expect(result.data.securityScanLevel).toBe("standard");
      expect(result.data.deployTarget).toBe("manual");
    }
  });

  it("validates agentAggressiveness enum", () => {
    for (const value of ["balanced", "full_auto", "supervised"]) {
      expect(
        projectSettingsSchema.safeParse({ agentAggressiveness: value }).success
      ).toBe(true);
    }
    expect(
      projectSettingsSchema.safeParse({ agentAggressiveness: "invalid" })
        .success
    ).toBe(false);
  });

  it("rejects ciLoopMaxIterations out of range", () => {
    expect(
      projectSettingsSchema.safeParse({ ciLoopMaxIterations: 0 }).success
    ).toBe(false);
    expect(
      projectSettingsSchema.safeParse({ ciLoopMaxIterations: 51 }).success
    ).toBe(false);
  });

  it("rejects parallelAgentCount out of range", () => {
    expect(
      projectSettingsSchema.safeParse({ parallelAgentCount: 0 }).success
    ).toBe(false);
    expect(
      projectSettingsSchema.safeParse({ parallelAgentCount: 26 }).success
    ).toBe(false);
  });

  it("rejects testCoverageTarget out of range", () => {
    expect(
      projectSettingsSchema.safeParse({ testCoverageTarget: -1 }).success
    ).toBe(false);
    expect(
      projectSettingsSchema.safeParse({ testCoverageTarget: 101 }).success
    ).toBe(false);
  });
});

describe("connectRepoSchema", () => {
  it("validates a valid repo connection", () => {
    const result = connectRepoSchema.safeParse({
      projectId: "prj_123",
      repoUrl: "https://github.com/org/repo",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.branch).toBe("main");
      expect(result.data.provider).toBe("github");
    }
  });

  it("accepts gitlab provider", () => {
    const result = connectRepoSchema.safeParse({
      projectId: "prj_123",
      repoUrl: "https://gitlab.com/org/repo",
      provider: "gitlab",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid provider", () => {
    expect(
      connectRepoSchema.safeParse({
        projectId: "prj_123",
        repoUrl: "https://example.com",
        provider: "bitbucket",
      }).success
    ).toBe(false);
  });
});

describe("addProjectMemberSchema", () => {
  it("validates with defaults", () => {
    const result = addProjectMemberSchema.safeParse({
      projectId: "prj_123",
      userId: "usr_456",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe("contributor");
    }
  });

  it("accepts all valid roles", () => {
    for (const role of ["owner", "contributor", "viewer"]) {
      expect(
        addProjectMemberSchema.safeParse({
          projectId: "prj_123",
          userId: "usr_456",
          role,
        }).success
      ).toBe(true);
    }
  });
});

describe("listProjectsSchema", () => {
  it("applies default limit", () => {
    const result = listProjectsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
    }
  });

  it("accepts valid status filter", () => {
    for (const status of ["active", "archived", "setup"]) {
      expect(listProjectsSchema.safeParse({ status }).success).toBe(true);
    }
  });
});

// ============================================================================
// Task schemas
// ============================================================================

describe("taskStatusSchema", () => {
  it("accepts all valid statuses", () => {
    for (const status of [
      "pending",
      "queued",
      "running",
      "paused",
      "completed",
      "failed",
      "cancelled",
    ]) {
      expect(taskStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("rejects invalid statuses", () => {
    expect(taskStatusSchema.safeParse("active").success).toBe(false);
  });
});

describe("agentRoleSchema", () => {
  it("accepts all valid agent roles", () => {
    const roles = [
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
    for (const role of roles) {
      expect(agentRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it("rejects invalid roles", () => {
    expect(agentRoleSchema.safeParse("coder").success).toBe(false);
    expect(agentRoleSchema.safeParse("admin").success).toBe(false);
  });
});

describe("taskComplexitySchema", () => {
  it("accepts all complexity levels", () => {
    for (const level of ["simple_fix", "medium_task", "complex_task"]) {
      expect(taskComplexitySchema.safeParse(level).success).toBe(true);
    }
  });

  it("rejects invalid complexity", () => {
    expect(taskComplexitySchema.safeParse("easy").success).toBe(false);
  });
});

describe("submitTaskSchema", () => {
  it("validates a minimal task submission", () => {
    const result = submitTaskSchema.safeParse({
      sessionId: "ses_123",
      title: "Fix login bug",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe(5); // default
    }
  });

  it("validates with all fields", () => {
    const result = submitTaskSchema.safeParse({
      sessionId: "ses_123",
      title: "Build API",
      description: "Create REST endpoints",
      priority: 8,
      agentRole: "backend_coder",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    expect(
      submitTaskSchema.safeParse({ sessionId: "ses_123", title: "" }).success
    ).toBe(false);
  });

  it("rejects title exceeding 200 characters", () => {
    expect(
      submitTaskSchema.safeParse({
        sessionId: "ses_123",
        title: "x".repeat(201),
      }).success
    ).toBe(false);
  });

  it("rejects priority out of range", () => {
    expect(
      submitTaskSchema.safeParse({
        sessionId: "ses_123",
        title: "Test",
        priority: -1,
      }).success
    ).toBe(false);
    expect(
      submitTaskSchema.safeParse({
        sessionId: "ses_123",
        title: "Test",
        priority: 11,
      }).success
    ).toBe(false);
  });

  it("rejects description exceeding 5000 characters", () => {
    expect(
      submitTaskSchema.safeParse({
        sessionId: "ses_123",
        title: "Test",
        description: "x".repeat(5001),
      }).success
    ).toBe(false);
  });
});

describe("updateTaskSchema", () => {
  it("validates with taskId only", () => {
    expect(updateTaskSchema.safeParse({ taskId: "tsk_123" }).success).toBe(
      true
    );
  });

  it("validates partial updates", () => {
    const result = updateTaskSchema.safeParse({
      taskId: "tsk_123",
      title: "Updated title",
      status: "running",
      priority: 3,
    });
    expect(result.success).toBe(true);
  });
});

describe("cancelTaskSchema", () => {
  it("validates with taskId only", () => {
    expect(cancelTaskSchema.safeParse({ taskId: "tsk_123" }).success).toBe(
      true
    );
  });

  it("rejects reason exceeding 500 characters", () => {
    expect(
      cancelTaskSchema.safeParse({
        taskId: "tsk_123",
        reason: "x".repeat(501),
      }).success
    ).toBe(false);
  });
});

describe("fleetDispatchSchema", () => {
  it("validates a valid fleet dispatch", () => {
    const result = fleetDispatchSchema.safeParse({
      sessionId: "ses_123",
      tasks: [{ title: "Task 1" }, { title: "Task 2" }],
    });
    expect(result.success).toBe(true);
  });

  it("requires at least 1 task", () => {
    expect(
      fleetDispatchSchema.safeParse({ sessionId: "ses_123", tasks: [] }).success
    ).toBe(false);
  });

  it("rejects more than 10 tasks", () => {
    const tasks = Array.from({ length: 11 }, (_, i) => ({
      title: `Task ${i}`,
    }));
    expect(
      fleetDispatchSchema.safeParse({ sessionId: "ses_123", tasks }).success
    ).toBe(false);
  });

  it("validates task properties within the array", () => {
    expect(
      fleetDispatchSchema.safeParse({
        sessionId: "ses_123",
        tasks: [{ title: "" }],
      }).success
    ).toBe(false);
  });
});

describe("costEstimateSchema", () => {
  it("validates a valid cost estimate request", () => {
    const result = costEstimateSchema.safeParse({
      complexity: "simple_fix",
      mode: "task",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.agentCount).toBe(1);
    }
  });

  it("rejects agentCount exceeding 25", () => {
    expect(
      costEstimateSchema.safeParse({
        complexity: "medium_task",
        mode: "fleet",
        agentCount: 26,
      }).success
    ).toBe(false);
  });
});

// ============================================================================
// Blueprint schemas
// ============================================================================

describe("createBlueprintSchema", () => {
  it("validates a minimal blueprint", () => {
    const result = createBlueprintSchema.safeParse({
      projectId: "prj_123",
      content: "# Architecture\nMonorepo with Next.js",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("1.0.0");
      expect(result.data.techStack).toEqual([]);
    }
  });

  it("validates with techStack items", () => {
    const result = createBlueprintSchema.safeParse({
      projectId: "prj_123",
      content: "Blueprint content",
      techStack: [
        { category: "Framework", name: "Next.js", version: "14.0" },
        { category: "Database", name: "PostgreSQL" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty projectId", () => {
    expect(
      createBlueprintSchema.safeParse({
        projectId: "",
        content: "Content",
      }).success
    ).toBe(false);
  });

  it("rejects empty content", () => {
    expect(
      createBlueprintSchema.safeParse({
        projectId: "prj_123",
        content: "",
      }).success
    ).toBe(false);
  });

  it("rejects content exceeding 500000 characters", () => {
    expect(
      createBlueprintSchema.safeParse({
        projectId: "prj_123",
        content: "x".repeat(500_001),
      }).success
    ).toBe(false);
  });

  it("rejects techStack item with empty name", () => {
    expect(
      createBlueprintSchema.safeParse({
        projectId: "prj_123",
        content: "Content",
        techStack: [{ category: "Framework", name: "" }],
      }).success
    ).toBe(false);
  });
});

describe("updateBlueprintSchema", () => {
  it("validates with blueprintId only", () => {
    const result = updateBlueprintSchema.safeParse({
      blueprintId: "bp_123",
    });
    expect(result.success).toBe(true);
  });

  it("validates with optional isActive boolean", () => {
    const result = updateBlueprintSchema.safeParse({
      blueprintId: "bp_123",
      isActive: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty blueprintId", () => {
    expect(updateBlueprintSchema.safeParse({ blueprintId: "" }).success).toBe(
      false
    );
  });
});

describe("getBlueprintSchema", () => {
  it("validates with blueprintId", () => {
    expect(
      getBlueprintSchema.safeParse({ blueprintId: "bp_123" }).success
    ).toBe(true);
  });

  it("rejects missing blueprintId", () => {
    expect(getBlueprintSchema.safeParse({}).success).toBe(false);
  });
});
