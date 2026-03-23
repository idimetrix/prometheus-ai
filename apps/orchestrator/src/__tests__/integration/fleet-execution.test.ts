import { describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
  tasks: {},
  agents: {},
  sessions: {},
}));

vi.mock("@prometheus/utils", () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_mock`),
  orchestratorClient: { post: vi.fn() },
  modelRouterClient: { post: vi.fn(), getCircuitState: vi.fn(() => "closed") },
  projectBrainClient: { get: vi.fn() },
}));

vi.mock("@prometheus/telemetry", () => ({
  withSpan: (_name: string, fn: (span: unknown) => unknown) =>
    fn({ setAttribute: vi.fn() }),
  initTelemetry: vi.fn(),
  initSentry: vi.fn(),
}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@prometheus/queue", () => ({
  EventPublisher: class {
    publishSessionEvent = vi.fn().mockResolvedValue(undefined);
  },
  QueueEvents: {
    AGENT_STATUS: "agent_status",
    AGENT_OUTPUT: "agent_output",
    CREDIT_UPDATE: "credit_update",
    ERROR: "error",
  },
}));

describe("Fleet Execution", () => {
  it("should enforce tier parallelism limits", async () => {
    const { FleetManager } = await import("../../fleet-manager");

    const fleet = new FleetManager({
      sessionId: "ses_test",
      projectId: "proj_test",
      orgId: "org_test",
      userId: "user_test",
      planTier: "hobby",
    });

    const status = fleet.getStatus();
    expect(status.totalAgents).toBe(0);
    expect(status.sessionId).toBe("ses_test");
  });

  it("should compute parallel schedule from tasks", async () => {
    const { ParallelScheduler } = await import("../../parallel/scheduler");
    const scheduler = new ParallelScheduler();

    const tasks = [
      {
        id: "t1",
        title: "Setup DB",
        agentRole: "backend_coder",
        dependencies: [],
        effort: "S",
      },
      {
        id: "t2",
        title: "API routes",
        agentRole: "backend_coder",
        dependencies: ["t1"],
        effort: "M",
      },
      {
        id: "t3",
        title: "UI components",
        agentRole: "frontend_coder",
        dependencies: [],
        effort: "M",
      },
      {
        id: "t4",
        title: "Integration",
        agentRole: "integration_coder",
        dependencies: ["t2", "t3"],
        effort: "L",
      },
    ];

    const schedule = scheduler.schedule(tasks);
    expect(schedule.waves.length).toBeGreaterThanOrEqual(2);
    expect(schedule.waves[0]?.length).toBeGreaterThanOrEqual(1);

    // t1 and t3 should be in wave 1 (no deps)
    const wave1Ids = schedule.waves[0]?.map((t) => t.id) ?? [];
    expect(wave1Ids).toContain("t1");
    expect(wave1Ids).toContain("t3");
  });

  it("should compute critical path", async () => {
    const { ParallelScheduler } = await import("../../parallel/scheduler");
    const scheduler = new ParallelScheduler();

    const tasks = [
      {
        id: "a",
        title: "A",
        agentRole: "backend_coder",
        dependencies: [],
        effort: "S",
      },
      {
        id: "b",
        title: "B",
        agentRole: "backend_coder",
        dependencies: ["a"],
        effort: "M",
      },
      {
        id: "c",
        title: "C",
        agentRole: "frontend_coder",
        dependencies: ["b"],
        effort: "L",
      },
    ];

    const schedule = scheduler.schedule(tasks);
    expect(schedule.criticalPath.length).toBeGreaterThan(0);
    expect(schedule.waves.length).toBe(3);
  });
});
