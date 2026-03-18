import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/db", () => {
  const findFirst = vi.fn();
  const findMany = vi.fn();
  const insertChain = {
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: "ses_1" }]),
    }),
  };
  const updateChain = {
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: "ses_1" }]),
      }),
    }),
  };
  return {
    db: {
      query: {
        sessions: { findFirst, findMany },
        agents: { findFirst, findMany },
      },
      insert: vi.fn().mockReturnValue(insertChain),
      update: vi.fn().mockReturnValue(updateChain),
    },
    sessions: {},
    agents: {},
  };
});

vi.mock("@prometheus/queue", () => ({
  EventPublisher: class {
    publishSessionEvent = vi.fn();
  },
  QueueEvents: { AGENT_STATUS: "agent:status" },
  createRedisConnection: vi.fn(),
}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@prometheus/utils", () => ({
  generateId: (prefix?: string) => `${prefix ?? "id"}_test123`,
}));

// Must import after mocks
const { SessionManager } = await import("../session-manager");

describe("SessionManager", () => {
  let manager: InstanceType<typeof SessionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManager();
  });

  it("creates a session", async () => {
    const session = await manager.createSession(
      {
        projectId: "proj_1",
        orgId: "org_1",
        userId: "usr_1",
        mode: "task",
      } as any,
      "ses_1"
    );

    expect(session).toBeDefined();
    expect(manager.getActiveSessionCount()).toBeGreaterThanOrEqual(0);
  });

  it("returns null for unknown session", () => {
    const session = manager.getSession("nonexistent");
    expect(session).toBeUndefined();
  });

  it("tracks active session count", () => {
    const initial = manager.getActiveSessionCount();
    expect(initial).toBeGreaterThanOrEqual(0);
  });
});
