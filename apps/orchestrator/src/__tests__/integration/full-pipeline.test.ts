import { describe, expect, it, vi } from "vitest";

// Mock external services
vi.mock("@prometheus/db", () => ({
  db: {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
  },
  sessions: {},
  tasks: {},
  agents: {},
}));

vi.mock("@prometheus/queue", () => ({
  EventPublisher: class {
    publishSessionEvent = vi.fn().mockResolvedValue(undefined);
    publishNotification = vi.fn().mockResolvedValue(undefined);
  },
  QueueEvents: {
    AGENT_STATUS: "agent_status",
    AGENT_OUTPUT: "agent_output",
    FILE_CHANGE: "file_change",
    PLAN_UPDATE: "plan_update",
    TASK_STATUS: "task_status",
    CREDIT_UPDATE: "credit_update",
    CHECKPOINT: "checkpoint",
    ERROR: "error",
    TERMINAL_OUTPUT: "terminal_output",
    SESSION_RESUME: "session_resume",
  },
}));

describe("Full Pipeline Integration", () => {
  it("should create a session and track status", {
    timeout: 30_000,
  }, async () => {
    const { SessionManager } = await import("../../session-manager");
    const manager = new SessionManager();

    const session = await manager.createSession({
      projectId: "proj_test",
      userId: "user_test",
      orgId: "org_test",
      mode: "task",
    });

    expect(session.id).toBeTruthy();
    expect(session.status).toBe("active");
    expect(session.mode).toBe("task");

    const status = manager.getSessionStatus(session.id);
    expect(status).toBeTruthy();
    expect(status?.session.status).toBe("active");
  });

  it("should track active agent count", async () => {
    const { SessionManager } = await import("../../session-manager");
    const manager = new SessionManager();

    const session = await manager.createSession({
      projectId: "proj_test",
      userId: "user_test",
      orgId: "org_test",
      mode: "task",
    });

    manager.trackAgent(session.id, "agent_1", "backend_coder");
    manager.trackAgent(session.id, "agent_2", "frontend_coder");

    const status = manager.getSessionStatus(session.id);
    expect(status?.activeAgentCount).toBe(2);

    manager.untrackAgent(session.id, "agent_1");
    const updatedStatus = manager.getSessionStatus(session.id);
    expect(updatedStatus?.activeAgentCount).toBe(1);
  });

  it("should pause and resume sessions", async () => {
    const { SessionManager } = await import("../../session-manager");
    const manager = new SessionManager();

    const session = await manager.createSession({
      projectId: "proj_test",
      userId: "user_test",
      orgId: "org_test",
      mode: "task",
    });

    await manager.pauseSession(session.id);
    const paused = manager.getSessionStatus(session.id);
    expect(paused?.session.status).toBe("paused");

    await manager.resumeSession(session.id);
    const resumed = manager.getSessionStatus(session.id);
    expect(resumed?.session.status).toBe("active");
  });

  it("should route tasks based on mode", async () => {
    const { getModeHandler } = await import("../../modes");

    const askHandler = getModeHandler("ask");
    expect(askHandler.modeName).toBe("ask");

    const taskHandler = getModeHandler("task");
    expect(taskHandler.modeName).toBe("task");

    const planHandler = getModeHandler("plan");
    expect(planHandler.modeName).toBe("plan");

    const watchHandler = getModeHandler("watch");
    expect(watchHandler.modeName).toBe("watch");

    const fleetHandler = getModeHandler("fleet");
    expect(fleetHandler.modeName).toBe("fleet");
  });
});
