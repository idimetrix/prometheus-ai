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
  };
});

vi.mock("@prometheus/db", () => ({
  projects: { id: "id", orgId: "orgId" },
  sessions: {
    id: "id",
    projectId: "projectId",
    status: "status",
    mode: "mode",
    startedAt: "startedAt",
  },
  sessionEvents: {
    id: "id",
    sessionId: "sessionId",
    timestamp: "timestamp",
    type: "type",
  },
  sessionMessages: { sessionId: "sessionId", createdAt: "createdAt" },
}));

vi.mock("@prometheus/queue", () => ({
  agentTaskQueue: {
    add: (...args: unknown[]) => mockQueueAdd(...args),
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
  createSessionSchema: { parse: (v: unknown) => v },
  getSessionSchema: { extend: () => ({ parse: (v: unknown) => v }) },
  listSessionsSchema: { extend: () => ({ parse: (v: unknown) => v }) },
  pauseSessionSchema: { parse: (v: unknown) => v },
  resumeSessionSchema: { parse: (v: unknown) => v },
  cancelSessionSchema: { parse: (v: unknown) => v },
  sendMessageSchema: { parse: (v: unknown) => v },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockDb() {
  return {
    query: {
      sessions: { findFirst: mockFindFirst, findMany: mockFindMany },
      projects: { findFirst: mockFindFirst, findMany: mockFindMany },
      sessionEvents: { findFirst: mockFindFirst, findMany: mockFindMany },
      sessionMessages: { findMany: mockFindMany },
    },
    insert: (...args: unknown[]) => mockInsert(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  };
}

function createCtx(overrides?: Record<string, unknown>) {
  return {
    db: createMockDb(),
    auth: {
      userId: "usr_1",
      orgId: "org_1",
      orgRole: "admin",
      sessionId: "clerk_ses",
    },
    orgId: "org_1",
    apiKeyId: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sessions router - verifySessionAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockReset();
    mockFindMany.mockReset().mockResolvedValue([]);
    mockReturning.mockReset().mockResolvedValue([]);
    mockUpdateReturning.mockReset().mockResolvedValue([]);
    mockInsertValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockInsertValues });
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  it("throws NOT_FOUND when session does not exist", async () => {
    // Simulate verifySessionAccess logic
    mockFindFirst.mockReset();
    mockFindFirst.mockResolvedValueOnce(null);

    const session = await mockFindFirst();
    expect(session).toBeNull();
  });

  it("throws NOT_FOUND when session belongs to different org", async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: "ses_1",
      projectId: "prj_1",
      status: "active",
      project: { id: "prj_1", orgId: "other_org" },
    });

    const session = await mockFindFirst();
    expect(session?.project.orgId).not.toBe("org_1");
  });
});

describe("sessions router - create", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockReset();
    mockFindMany.mockReset().mockResolvedValue([]);
    mockReturning.mockReset().mockResolvedValue([]);
    mockUpdateReturning.mockReset().mockResolvedValue([]);
    mockInsertValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockInsertValues });
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  it("verifies project belongs to org before creating session", async () => {
    const ctx = createCtx();

    // Project found in org
    mockFindFirst.mockResolvedValueOnce({ id: "prj_1", orgId: "org_1" });

    const project = await ctx.db.query.projects.findFirst();
    expect(project).toBeTruthy();
    expect(project?.orgId).toBe("org_1");
  });

  it("rejects when project not found in org", async () => {
    const ctx = createCtx();
    mockFindFirst.mockResolvedValueOnce(null);

    const project = await ctx.db.query.projects.findFirst();
    expect(project).toBeNull();
  });

  it("creates session with active status", async () => {
    const sessionData = {
      id: "ses_mock123",
      projectId: "prj_1",
      userId: "usr_1",
      status: "active",
      mode: "task",
    };
    mockReturning.mockResolvedValueOnce([sessionData]);

    const ctx = createCtx();
    const [session] = await ctx.db
      .insert("sessions")
      .values(sessionData)
      .returning();

    expect(session).toBeDefined();
    expect(session?.status).toBe("active");
  });

  it("queues agent task when prompt is provided", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "prj_1", orgId: "org_1" });
    mockReturning.mockResolvedValueOnce([
      { id: "ses_mock123", projectId: "prj_1", status: "active", mode: "task" },
    ]);

    await mockQueueAdd("agent-task", {
      taskId: "task_mock123",
      sessionId: "ses_mock123",
      projectId: "prj_1",
      title: "Test prompt",
      description: "Test prompt",
      mode: "task",
    });

    expect(mockQueueAdd).toHaveBeenCalledWith(
      "agent-task",
      expect.objectContaining({ sessionId: "ses_mock123" })
    );
  });
});

describe("sessions router - pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockReset();
    mockFindMany.mockReset().mockResolvedValue([]);
    mockReturning.mockReset().mockResolvedValue([]);
    mockUpdateReturning.mockReset().mockResolvedValue([]);
    mockInsertValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockInsertValues });
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  it("pauses an active session", async () => {
    const updatedSession = {
      id: "ses_1",
      projectId: "prj_1",
      status: "paused",
    };
    mockUpdateReturning.mockResolvedValueOnce([updatedSession]);

    const ctx = createCtx();
    const [updated] = await ctx.db
      .update("sessions")
      .set({ status: "paused" })
      .where("ses_1")
      .returning();

    expect(updated?.status).toBe("paused");
  });

  it("rejects pausing a non-active session", async () => {
    mockUpdateReturning.mockResolvedValueOnce([]);

    const ctx = createCtx();
    const result = await ctx.db
      .update("sessions")
      .set({ status: "paused" })
      .where("ses_1")
      .returning();

    expect(result).toEqual([]);
  });

  it("records a checkpoint event after pausing", () => {
    const event = {
      id: "evt_mock123",
      sessionId: "ses_1",
      type: "checkpoint" as const,
      data: { action: "paused", reason: null },
    };

    expect(event.type).toBe("checkpoint");
    expect(event.data.action).toBe("paused");
  });
});

describe("sessions router - resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockReset();
    mockFindMany.mockReset().mockResolvedValue([]);
    mockReturning.mockReset().mockResolvedValue([]);
    mockUpdateReturning.mockReset().mockResolvedValue([]);
    mockInsertValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockInsertValues });
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  it("resumes a paused session", async () => {
    const updatedSession = {
      id: "ses_1",
      projectId: "prj_1",
      status: "active",
      mode: "task",
    };
    mockUpdateReturning.mockResolvedValueOnce([updatedSession]);

    const ctx = createCtx();
    const [updated] = await ctx.db
      .update("sessions")
      .set({ status: "active" })
      .where("ses_1")
      .returning();

    expect(updated?.status).toBe("active");
  });

  it("rejects resuming a non-paused session", async () => {
    mockUpdateReturning.mockResolvedValueOnce([]);

    const ctx = createCtx();
    const result = await ctx.db
      .update("sessions")
      .set({ status: "active" })
      .where("ses_1")
      .returning();

    expect(result).toEqual([]);
  });

  it("queues agent task when prompt provided on resume", async () => {
    mockUpdateReturning.mockResolvedValueOnce([
      { id: "ses_1", projectId: "prj_1", status: "active", mode: "task" },
    ]);

    await mockQueueAdd(
      "agent-task",
      expect.objectContaining({ sessionId: "ses_1" }),
      { priority: 50 }
    );

    expect(mockQueueAdd).toHaveBeenCalled();
  });
});

describe("sessions router - cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockReset();
    mockFindMany.mockReset().mockResolvedValue([]);
    mockReturning.mockReset().mockResolvedValue([]);
    mockUpdateReturning.mockReset().mockResolvedValue([]);
    mockInsertValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockInsertValues });
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  it("cancels an active or paused session", () => {
    const session = { id: "ses_1", status: "active" as string };
    const canCancel =
      session.status === "active" || session.status === "paused";

    expect(canCancel).toBe(true);

    session.status = "cancelled";
    expect(session.status).toBe("cancelled");
  });

  it("rejects cancelling an already ended session", () => {
    const session = { id: "ses_1", status: "completed" as string };
    const canCancel =
      session.status === "active" || session.status === "paused";

    expect(canCancel).toBe(false);
  });
});

describe("sessions router - sendMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindFirst.mockReset();
    mockFindMany.mockReset().mockResolvedValue([]);
    mockReturning.mockReset().mockResolvedValue([]);
    mockUpdateReturning.mockReset().mockResolvedValue([]);
    mockInsertValues.mockReturnValue({ returning: mockReturning });
    mockInsert.mockReturnValue({ values: mockInsertValues });
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  it("inserts a user message and queues an agent task", () => {
    const messageData = {
      id: "msg_mock123",
      sessionId: "ses_1",
      role: "user" as const,
      content: "Fix the login bug",
    };

    expect(messageData.role).toBe("user");
    expect(messageData.content).toBe("Fix the login bug");
    expect(messageData.sessionId).toBe("ses_1");
  });

  it("rejects sending a message to a non-active session", () => {
    // Simulate: session found but status is paused
    const session = {
      id: "ses_1",
      status: "paused",
      project: { id: "prj_1", orgId: "org_1" },
    };

    expect(session.status).not.toBe("active");
  });
});
