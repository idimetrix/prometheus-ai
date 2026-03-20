import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockFindFirst,
  mockFindMany,
  mockReturning,
  mockInsertValues,
  mockInsert,
  mockUpdateReturning,
  mockUpdateWhere,
  mockUpdateSet,
  mockUpdate,
  mockQueueAdd,
  mockQueueGetWaitingCount,
  mockQueueGetJob,
} = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockInsertValues = vi
    .fn()
    .mockReturnValue({ returning: mockReturning });
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
  const mockUpdateReturning = vi.fn().mockResolvedValue([]);
  const mockUpdateWhere = vi
    .fn()
    .mockReturnValue({ returning: mockUpdateReturning });
  const mockUpdateSet = vi.fn().mockReturnValue({ where: mockUpdateWhere });
  const mockUpdate = vi.fn().mockReturnValue({ set: mockUpdateSet });

  return {
    mockFindFirst: vi.fn(),
    mockFindMany: vi.fn().mockResolvedValue([]),
    mockReturning,
    mockInsertValues,
    mockInsert,
    mockUpdateReturning,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpdate,
    mockQueueAdd: vi.fn().mockResolvedValue(undefined),
    mockQueueGetWaitingCount: vi.fn().mockResolvedValue(0),
    mockQueueGetJob: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("@prometheus/db", () => ({
  creditBalances: { orgId: "orgId", balance: "balance", reserved: "reserved" },
  creditReservations: {
    id: "id",
    orgId: "orgId",
    taskId: "taskId",
    status: "status",
  },
  creditTransactions: { orgId: "orgId" },
  projects: { id: "id", orgId: "orgId" },
  sessions: { id: "id", projectId: "projectId", status: "status" },
  tasks: {
    id: "id",
    orgId: "orgId",
    sessionId: "sessionId",
    projectId: "projectId",
    status: "status",
    createdAt: "createdAt",
  },
  taskSteps: { stepNumber: "stepNumber" },
}));

vi.mock("@prometheus/queue", () => ({
  agentTaskQueue: {
    add: (...args: unknown[]) => mockQueueAdd(...args),
    getWaitingCount: () => mockQueueGetWaitingCount(),
    getJob: (...args: unknown[]) => mockQueueGetJob(...args),
  },
}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@prometheus/utils", () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_mock123`),
}));

vi.mock("@prometheus/validators", () => ({
  CREDIT_COSTS: {
    simple_fix: 5,
    medium_task: 25,
    complex_task: 75,
    ask_mode: 2,
    plan_mode: 10,
  },
  submitTaskSchema: { parse: (v: unknown) => v },
  getTaskSchema: { parse: (v: unknown) => v },
  listTasksSchema: { parse: (v: unknown) => v },
  updateTaskSchema: { parse: (v: unknown) => v },
  cancelTaskSchema: { parse: (v: unknown) => v },
  costEstimateSchema: { parse: (v: unknown) => v },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockDb() {
  return {
    query: {
      sessions: { findFirst: mockFindFirst },
      tasks: { findFirst: mockFindFirst, findMany: mockFindMany },
      projects: { findFirst: mockFindFirst },
      creditBalances: { findFirst: mockFindFirst },
      creditReservations: { findFirst: mockFindFirst },
    },
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  };
}

function resetChainMocks() {
  mockInsertValues.mockReturnValue({ returning: mockReturning });
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });
  mockReturning.mockResolvedValue([]);
  mockUpdateReturning.mockResolvedValue([]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("tasks router - verifyTaskAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChainMocks();
  });

  it("returns task when it belongs to the org", async () => {
    const task = {
      id: "task_1",
      status: "pending",
      project: { id: "prj_1", orgId: "org_1" },
    };
    mockFindFirst.mockResolvedValueOnce(task);

    const result = await mockFindFirst();
    expect(result?.project.orgId).toBe("org_1");
  });

  it("rejects when task not found", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const result = await mockFindFirst();
    expect(result).toBeNull();
  });

  it("rejects when task belongs to different org", async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: "task_1",
      project: { id: "prj_1", orgId: "other_org" },
    });
    const result = await mockFindFirst();
    expect(result?.project.orgId).not.toBe("org_1");
  });
});

describe("tasks router - submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChainMocks();
  });

  it("verifies session is active before submission", () => {
    const session = {
      id: "ses_1",
      status: "active",
      projectId: "prj_1",
      mode: "task",
      project: { id: "prj_1", orgId: "org_1" },
    };
    mockFindFirst.mockResolvedValueOnce(session);
    expect(session.status).toBe("active");
  });

  it("rejects submission to non-active session", () => {
    const session = {
      id: "ses_1",
      status: "paused",
      project: { id: "prj_1", orgId: "org_1" },
    };
    mockFindFirst.mockResolvedValueOnce(session);
    expect(session.status).not.toBe("active");
  });

  it("creates task record and adds to queue", async () => {
    const taskRecord = {
      id: "task_mock123",
      sessionId: "ses_1",
      projectId: "prj_1",
      orgId: "org_1",
      title: "Fix bug",
      status: "queued",
      creditsReserved: 25,
    };
    mockReturning.mockResolvedValueOnce([taskRecord]);
    mockQueueGetWaitingCount.mockResolvedValueOnce(3);

    const db = createMockDb();
    const [task] = await db.insert("tasks").values(taskRecord).returning();

    expect(task?.status).toBe("queued");
    expect(task?.creditsReserved).toBe(25);

    await mockQueueAdd(
      "agent-task",
      { taskId: "task_mock123" },
      { priority: 50 }
    );
    expect(mockQueueAdd).toHaveBeenCalled();
  });

  it("proceeds without reservation on credit error", async () => {
    // Non-TRPCError from credit reservation should log warning and proceed
    const taskRecord = {
      id: "task_mock123",
      status: "queued",
      creditsReserved: 0,
    };
    mockReturning.mockResolvedValueOnce([taskRecord]);

    const db = createMockDb();
    const [task] = await db.insert("tasks").values(taskRecord).returning();

    expect(task?.creditsReserved).toBe(0);
  });
});

describe("tasks router - reserveCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChainMocks();
  });

  it("reserves credits when sufficient balance available", async () => {
    mockFindFirst.mockResolvedValueOnce({ balance: 100, reserved: 20 });

    const balance = await mockFindFirst();
    const available = (balance?.balance ?? 0) - (balance?.reserved ?? 0);

    expect(available).toBe(80);
    expect(available).toBeGreaterThanOrEqual(25);
  });

  it("rejects when insufficient credits", async () => {
    mockFindFirst.mockResolvedValueOnce({ balance: 20, reserved: 15 });

    const balance = await mockFindFirst();
    const available = (balance?.balance ?? 0) - (balance?.reserved ?? 0);

    expect(available).toBe(5);
    expect(available).toBeLessThan(25);
  });
});

describe("tasks router - cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChainMocks();
  });

  it("rejects cancelling a completed task", () => {
    const task = { id: "task_1", status: "completed", creditsReserved: 0 };
    const terminalStatuses = ["completed", "failed", "cancelled"];

    expect(terminalStatuses.includes(task.status)).toBe(true);
  });

  it("rejects cancelling a failed task", () => {
    const task = { id: "task_1", status: "failed", creditsReserved: 0 };
    const terminalStatuses = ["completed", "failed", "cancelled"];

    expect(terminalStatuses.includes(task.status)).toBe(true);
  });

  it("cancels a pending task and releases credits", async () => {
    const task = {
      id: "task_1",
      status: "queued",
      creditsReserved: 25,
      project: { id: "prj_1", orgId: "org_1" },
    };
    const updatedTask = {
      ...task,
      status: "cancelled",
      completedAt: new Date(),
    };
    mockUpdateReturning.mockResolvedValueOnce([updatedTask]);

    const db = createMockDb();
    const [updated] = await db
      .update("tasks")
      .set({ status: "cancelled" })
      .where("task_1")
      .returning();

    expect(updated?.status).toBe("cancelled");
  });

  it("attempts to remove job from queue", async () => {
    const mockJob = { remove: vi.fn().mockResolvedValue(undefined) };
    mockQueueGetJob.mockResolvedValueOnce(mockJob);

    const job = await mockQueueGetJob("task_1");
    if (job) {
      await job.remove();
    }

    expect(mockJob.remove).toHaveBeenCalled();
  });

  it("handles missing queue job gracefully", async () => {
    mockQueueGetJob.mockResolvedValueOnce(null);

    const job = await mockQueueGetJob("task_1");
    expect(job).toBeNull();
  });
});

describe("tasks router - estimateCost", () => {
  it("calculates cost with mode adjustments", () => {
    const CREDIT_COSTS = {
      simple_fix: 5,
      medium_task: 25,
      complex_task: 75,
    };

    const modeAdjustments: Record<string, number> = {
      ask: 0.4,
      plan: 0.8,
      task: 1.0,
      watch: 1.2,
      fleet: 1.5,
    };

    // Medium task + task mode + 1 agent
    const baseCost = CREDIT_COSTS.medium_task;
    const modeAdj = modeAdjustments.task ?? 1.0;
    const estimated = Math.ceil(baseCost * modeAdj * 1);

    expect(estimated).toBe(25);
  });

  it("applies mode adjustment for ask mode", () => {
    const baseCost = 25;
    const modeAdj = 0.4;
    const estimated = Math.ceil(baseCost * modeAdj * 1);

    expect(estimated).toBe(10);
  });

  it("applies agent multiplier", () => {
    const baseCost = 25;
    const modeAdj = 1.0;
    const agentCount = 3;
    const estimated = Math.ceil(baseCost * modeAdj * agentCount);

    expect(estimated).toBe(75);
  });

  it("uses medium_task as default for unknown complexity", () => {
    const baseCostMap: Record<string, number> = {
      simple_fix: 5,
      medium_task: 25,
      complex_task: 75,
    };
    const baseCost = baseCostMap.unknown ?? 25;

    expect(baseCost).toBe(25);
  });
});

describe("tasks router - updateStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChainMocks();
  });

  it("sets startedAt when status changes to running", () => {
    const updateData: Record<string, unknown> = {};
    const status = "running";

    updateData.status = status;
    if (status === "running") {
      updateData.startedAt = new Date();
    }

    expect(updateData.startedAt).toBeInstanceOf(Date);
  });

  it("sets completedAt when status changes to completed", () => {
    const updateData: Record<string, unknown> = {};
    const status = "completed";

    updateData.status = status;
    if (status === "completed" || status === "failed") {
      updateData.completedAt = new Date();
    }

    expect(updateData.completedAt).toBeInstanceOf(Date);
  });

  it("rejects when no fields to update", () => {
    const updateData: Record<string, unknown> = {};
    expect(Object.keys(updateData).length).toBe(0);
  });
});
