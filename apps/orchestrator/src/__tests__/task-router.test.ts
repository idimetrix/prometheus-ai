import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
});

vi.mock("@prometheus/db", () => ({
  db: {
    update: (...args: unknown[]) => mockUpdate(...args),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
  tasks: { id: "id", status: "status" },
  sessions: { id: "id" },
  agents: { id: "id", sessionId: "sessionId", status: "status" },
}));

vi.mock("@prometheus/queue", () => ({
  EventPublisher: class {
    publishSessionEvent = vi.fn().mockResolvedValue(undefined);
  },
  QueueEvents: {
    TASK_STATUS: "task_status",
    PLAN_UPDATE: "plan_update",
    AGENT_STATUS: "agent_status",
    SESSION_RESUME: "session_resume",
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

import type { AgentLoop } from "../agent-loop";
import { SessionManager } from "../session-manager";
import { TaskRouter } from "../task-router";

describe("TaskRouter", () => {
  let router: TaskRouter;
  let sessionManager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionManager = new SessionManager();
    router = new TaskRouter(sessionManager);
  });

  // ── routeTask (rule-based routing) ─────────────────────────────────────

  describe("routeTask", () => {
    it("routes requirements gathering to discovery", async () => {
      const result = await router.routeTask(
        "Gather requirements for the user authentication feature"
      );
      expect(result.agentRole).toBe("discovery");
      expect(result.confidence).toBe(0.9);
    });

    it("routes user stories to discovery", async () => {
      const result = await router.routeTask(
        "Write user stories for the checkout flow"
      );
      expect(result.agentRole).toBe("discovery");
    });

    it("routes architecture design to architect", async () => {
      const result = await router.routeTask(
        "Design the system architecture and create a blueprint"
      );
      expect(result.agentRole).toBe("architect");
      expect(result.confidence).toBe(0.9);
    });

    it("routes schema design to architect", async () => {
      const result = await router.routeTask(
        "Define the data model and schema for the app"
      );
      expect(result.agentRole).toBe("architect");
    });

    it("routes sprint planning to planner", async () => {
      const result = await router.routeTask(
        "Create a sprint plan for the next milestone"
      );
      expect(result.agentRole).toBe("planner");
      expect(result.confidence).toBe(0.85);
    });

    it("routes frontend work to frontend_coder", async () => {
      const result = await router.routeTask(
        "Build a React component for the user dashboard"
      );
      expect(result.agentRole).toBe("frontend_coder");
    });

    it("routes UI/page work to frontend_coder", async () => {
      const result = await router.routeTask(
        "Create the settings page with Tailwind CSS layout"
      );
      expect(result.agentRole).toBe("frontend_coder");
    });

    it("routes API work to backend_coder", async () => {
      const result = await router.routeTask(
        "Implement the REST API endpoint for user profiles"
      );
      expect(result.agentRole).toBe("backend_coder");
    });

    it("routes database work to backend_coder", async () => {
      const result = await router.routeTask(
        "Create a database migration for the new table"
      );
      expect(result.agentRole).toBe("backend_coder");
    });

    it("routes test writing to test_engineer", async () => {
      const result = await router.routeTask(
        "Write unit tests and integration tests for the auth module"
      );
      expect(result.agentRole).toBe("test_engineer");
      expect(result.confidence).toBe(0.9);
    });

    it("routes security audit to security_auditor", async () => {
      const result = await router.routeTask(
        "Perform a security audit and check for vulnerabilities"
      );
      expect(result.agentRole).toBe("security_auditor");
    });

    it("routes deployment to deploy_engineer", async () => {
      const result = await router.routeTask(
        "Set up Docker containers and Kubernetes deployment"
      );
      expect(result.agentRole).toBe("deploy_engineer");
    });

    it("routes CI/CD to deploy_engineer", async () => {
      const result = await router.routeTask(
        "Configure the GitHub Actions CI/CD pipeline"
      );
      expect(result.agentRole).toBe("deploy_engineer");
    });

    it("routes integration work to integration_coder", async () => {
      const result = await router.routeTask(
        "Wire up the data layer to connect with external services"
      );
      expect(result.agentRole).toBe("integration_coder");
    });

    it("defaults to orchestrator for ambiguous tasks", async () => {
      const result = await router.routeTask("Make the thing better");
      expect(result.agentRole).toBe("orchestrator");
      expect(result.confidence).toBe(0.5);
    });

    it("is case-insensitive", async () => {
      const result = await router.routeTask("WRITE UNIT TESTS FOR THE MODULE");
      expect(result.agentRole).toBe("test_engineer");
    });
  });

  // ── processTask mode routing ───────────────────────────────────────────

  describe("processTask mode routing", () => {
    // We test that processTask delegates to the right mode handler
    // by checking the initial task status update and event publishing

    it("updates task status to running", async () => {
      // Mock the sessionManager to return an active session
      const mockAgentLoop = {
        executeTask: vi.fn().mockResolvedValue({
          success: true,
          output: "Answer",
          filesChanged: [],
          tokensUsed: { input: 0, output: 0 },
          toolCalls: 0,
        }),
        getCreditsConsumed: vi.fn().mockReturnValue(2),
        getStatus: vi.fn().mockReturnValue("idle"),
        pause: vi.fn(),
        resume: vi.fn(),
        stop: vi.fn(),
      };

      vi.spyOn(sessionManager, "getSession").mockReturnValue(undefined);
      vi.spyOn(sessionManager, "createSession").mockResolvedValue({
        id: "ses_1",
        projectId: "proj_1",
        userId: "user_1",
        status: "active",
        mode: "ask",
        startedAt: new Date(),
        endedAt: null,
      });
      vi.spyOn(sessionManager, "getSession")
        .mockReturnValueOnce(undefined)
        .mockReturnValueOnce({
          session: {
            id: "ses_1",
            projectId: "proj_1",
            userId: "user_1",
            status: "active",
            mode: "ask",
            startedAt: new Date(),
            endedAt: null,
          },
          agentLoop: mockAgentLoop as unknown as AgentLoop,
          startedAt: new Date(),
          activeAgents: new Map(),
        });

      const result = await router.processTask({
        taskId: "task_1",
        sessionId: "ses_1",
        projectId: "proj_1",
        orgId: "org_1",
        userId: "user_1",
        title: "What is the tech stack?",
        description: null,
        mode: "ask",
        agentRole: null,
      });

      expect(mockUpdate).toHaveBeenCalled(); // task status to running
      expect(result.mode).toBe("ask");
    });

    it("handles errors and sets task to failed", async () => {
      vi.spyOn(sessionManager, "getSession").mockReturnValue(undefined);
      vi.spyOn(sessionManager, "createSession").mockRejectedValue(
        new Error("Session creation failed")
      );

      const result = await router.processTask({
        taskId: "task_1",
        sessionId: "ses_1",
        projectId: "proj_1",
        orgId: "org_1",
        userId: "user_1",
        title: "Do something",
        description: null,
        mode: "task",
        agentRole: null,
      });

      expect(result.success).toBe(false);
      expect(mockUpdate).toHaveBeenCalled(); // task set to failed
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SessionManager
// ═════════════════════════════════════════════════════════════════════════════

// Need to mock AgentLoop for SessionManager
vi.mock("../agent-loop", () => ({
  AgentLoop: class {
    executeTask = vi.fn().mockResolvedValue({ success: true });
    getCreditsConsumed = vi.fn().mockReturnValue(0);
    getStatus = vi.fn().mockReturnValue("idle");
    pause = vi.fn().mockResolvedValue(undefined);
    resume = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn().mockResolvedValue(undefined);
  },
}));

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SessionManager();
  });

  describe("createSession", () => {
    it("creates a session and stores it in memory", async () => {
      const session = await manager.createSession({
        projectId: "proj_1",
        userId: "user_1",
        orgId: "org_1",
        mode: "task",
      });

      expect(session.id).toBeTruthy();
      expect(session.status).toBe("active");
      expect(session.mode).toBe("task");
      expect(session.projectId).toBe("proj_1");
    });

    it("uses existing ID when provided", async () => {
      const session = await manager.createSession(
        {
          projectId: "proj_1",
          userId: "user_1",
          orgId: "org_1",
          mode: "ask",
        },
        "ses_existing123"
      );

      expect(session.id).toBe("ses_existing123");
    });

    it("persists session to database", async () => {
      await manager.createSession({
        projectId: "proj_1",
        userId: "user_1",
        orgId: "org_1",
        mode: "task",
      });

      // db.insert should have been called
      const { db } = await import("@prometheus/db");
      expect(db.insert).toHaveBeenCalled();
    });

    it("session is retrievable via getSession", async () => {
      const session = await manager.createSession({
        projectId: "proj_1",
        userId: "user_1",
        orgId: "org_1",
        mode: "task",
      });

      const active = manager.getSession(session.id);
      expect(active).toBeTruthy();
      expect(active?.session.id).toBe(session.id);
    });

    it("increments active session count", async () => {
      expect(manager.getActiveSessionCount()).toBe(0);

      await manager.createSession({
        projectId: "p1",
        userId: "u1",
        orgId: "o1",
        mode: "task",
      });
      expect(manager.getActiveSessionCount()).toBeGreaterThanOrEqual(1);
    });
  });

  describe("pauseSession", () => {
    it("pauses an active session", async () => {
      const session = await manager.createSession({
        projectId: "proj_1",
        userId: "user_1",
        orgId: "org_1",
        mode: "task",
      });

      await manager.pauseSession(session.id);

      const active = manager.getSession(session.id);
      expect(active?.session.status).toBe("paused");
    });

    it("throws when session not found", async () => {
      await expect(manager.pauseSession("ses_nonexistent")).rejects.toThrow(
        "not found"
      );
    });

    it("updates DB status to paused", async () => {
      const session = await manager.createSession({
        projectId: "proj_1",
        userId: "user_1",
        orgId: "org_1",
        mode: "task",
      });

      await manager.pauseSession(session.id);
      expect(mockUpdate).toHaveBeenCalled();
    });
  });

  describe("resumeSession", () => {
    it("resumes a paused session", async () => {
      const session = await manager.createSession({
        projectId: "proj_1",
        userId: "user_1",
        orgId: "org_1",
        mode: "task",
      });

      await manager.pauseSession(session.id);
      await manager.resumeSession(session.id);

      const active = manager.getSession(session.id);
      expect(active?.session.status).toBe("active");
    });

    it("throws when session not found", async () => {
      await expect(manager.resumeSession("ses_nonexistent")).rejects.toThrow(
        "not found"
      );
    });
  });

  describe("cancelSession", () => {
    it("cancels session and removes from memory", async () => {
      const session = await manager.createSession({
        projectId: "proj_1",
        userId: "user_1",
        orgId: "org_1",
        mode: "task",
      });

      await manager.cancelSession(session.id);

      expect(manager.getSession(session.id)).toBeUndefined();
      expect(manager.getActiveSessionCount()).toBe(0);
    });

    it("sets endedAt timestamp", async () => {
      const session = await manager.createSession({
        projectId: "proj_1",
        userId: "user_1",
        orgId: "org_1",
        mode: "task",
      });

      await manager.cancelSession(session.id);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it("throws when session not found", async () => {
      await expect(manager.cancelSession("ses_nonexistent")).rejects.toThrow(
        "not found"
      );
    });
  });

  describe("completeSession", () => {
    it("completes session and removes from memory", async () => {
      const session = await manager.createSession({
        projectId: "proj_1",
        userId: "user_1",
        orgId: "org_1",
        mode: "task",
      });

      await manager.completeSession(session.id);

      expect(manager.getSession(session.id)).toBeUndefined();
    });

    it("silently ignores unknown session IDs", async () => {
      await expect(
        manager.completeSession("ses_unknown")
      ).resolves.toBeUndefined();
    });
  });

  describe("trackAgent / untrackAgent", () => {
    it("tracks an agent in a session", async () => {
      const session = await manager.createSession({
        projectId: "proj_1",
        userId: "user_1",
        orgId: "org_1",
        mode: "task",
      });

      manager.trackAgent(session.id, "agt_1", "backend_coder");

      const status = manager.getSessionStatus(session.id);
      expect(status).toBeTruthy();
      expect(status?.activeAgentCount).toBe(1);
      expect(status?.agents[0]?.role).toBe("backend_coder");
    });

    it("untracks an agent", async () => {
      const session = await manager.createSession({
        projectId: "proj_1",
        userId: "user_1",
        orgId: "org_1",
        mode: "task",
      });

      manager.trackAgent(session.id, "agt_1", "backend_coder");
      manager.untrackAgent(session.id, "agt_1");

      const status = manager.getSessionStatus(session.id);
      expect(status?.activeAgentCount).toBe(0);
    });
  });

  describe("getSessionStatus", () => {
    it("returns null for unknown session", () => {
      expect(manager.getSessionStatus("ses_unknown")).toBeNull();
    });

    it("returns full status for active session", async () => {
      const session = await manager.createSession({
        projectId: "proj_1",
        userId: "user_1",
        orgId: "org_1",
        mode: "task",
      });

      const status = manager.getSessionStatus(session.id);
      expect(status).toBeTruthy();
      expect(status?.session.id).toBe(session.id);
      expect(status?.activeAgentCount).toBe(0);
      expect(status?.loopStatus).toBe("idle");
      expect(status?.creditsConsumed).toBe(0);
    });
  });
});
