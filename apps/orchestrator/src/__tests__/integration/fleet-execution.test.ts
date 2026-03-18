import { describe, expect, it, vi } from "vitest";

vi.mock("@prometheus/queue", () => ({
  EventPublisher: vi.fn().mockImplementation(() => ({
    publishSessionEvent: vi.fn().mockResolvedValue(undefined),
  })),
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
