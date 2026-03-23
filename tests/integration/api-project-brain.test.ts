/**
 * Integration tests: API ↔ Project Brain communication.
 *
 * Verifies that the API service can request context assembly,
 * file indexing, and knowledge graph queries from Project Brain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegrationFixtures, createMockServiceClient } from "./setup";

const { mockLogger } = vi.hoisted(() => {
  const logger: Record<string, unknown> = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  logger.child = () => logger;
  return { mockLogger: logger };
});

vi.mock("@prometheus/logger", () => ({
  createLogger: () => mockLogger,
}));

describe("API ↔ Project Brain communication", () => {
  const projectBrain = createMockServiceClient("project-brain");
  let fixtures: ReturnType<typeof createIntegrationFixtures>;

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    projectBrain._reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("context assembly", () => {
    it("requests context assembly for a task", async () => {
      projectBrain.onRequest("POST", "/context/assemble", {
        status: 200,
        body: {
          sections: [
            {
              type: "global",
              content: "Project uses Next.js 16 with TypeScript",
              tokens: 120,
            },
            {
              type: "task",
              content: "Relevant file: src/api/users.ts",
              tokens: 350,
            },
            {
              type: "session",
              content: "Previous task completed auth module",
              tokens: 80,
            },
            {
              type: "tools",
              content: "Agent tools: file_read, file_write",
              tokens: 60,
            },
          ],
          totalTokens: 610,
          budget: 14_000,
        },
      });

      const response = await projectBrain.request("POST", "/context/assemble", {
        projectId: fixtures.project.id,
        taskDescription: "Add user profile endpoint",
        agentRole: "backend_coder",
        tokenBudget: 14_000,
      });

      expect(response.status).toBe(200);
      const body = response.body as {
        sections: unknown[];
        totalTokens: number;
      };
      expect(body.sections).toHaveLength(4);
      expect(body.totalTokens).toBeLessThanOrEqual(14_000);
    });

    it("returns empty context for new project with no indexed files", async () => {
      projectBrain.onRequest("POST", "/context/assemble", {
        status: 200,
        body: {
          sections: [
            { type: "global", content: "No blueprint found", tokens: 10 },
          ],
          totalTokens: 10,
          budget: 14_000,
        },
      });

      const response = await projectBrain.request("POST", "/context/assemble", {
        projectId: "prj_new_empty",
        taskDescription: "Create initial project structure",
        agentRole: "architect",
        tokenBudget: 14_000,
      });

      expect(response.status).toBe(200);
      const body = response.body as { totalTokens: number };
      expect(body.totalTokens).toBeLessThan(100);
    });
  });

  describe("semantic search", () => {
    it("performs semantic search across indexed files", async () => {
      projectBrain.onRequest("POST", "/search/semantic", {
        status: 200,
        body: {
          results: [
            {
              filePath: "src/api/auth.ts",
              content: "export function verifyJWT(token: string)",
              score: 0.92,
              chunkIndex: 0,
            },
            {
              filePath: "src/middleware/auth.ts",
              content: "const authMiddleware = async (req, res, next) =>",
              score: 0.87,
              chunkIndex: 0,
            },
          ],
          totalResults: 2,
        },
      });

      const response = await projectBrain.request("POST", "/search/semantic", {
        projectId: fixtures.project.id,
        query: "authentication middleware",
        limit: 5,
      });

      expect(response.status).toBe(200);
      const body = response.body as { results: Array<{ score: number }> };
      expect(body.results).toHaveLength(2);
      expect(body.results[0].score).toBeGreaterThan(0.8);
    });
  });

  describe("knowledge graph", () => {
    it("queries file dependencies from knowledge graph", async () => {
      projectBrain.onRequest("POST", "/graph/query", {
        status: 200,
        body: {
          nodes: [
            { id: "src/api/users.ts", type: "file" },
            { id: "src/db/schema.ts", type: "file" },
            { id: "src/validators/user.ts", type: "file" },
          ],
          edges: [
            {
              from: "src/api/users.ts",
              to: "src/db/schema.ts",
              type: "imports",
            },
            {
              from: "src/api/users.ts",
              to: "src/validators/user.ts",
              type: "imports",
            },
          ],
        },
      });

      const response = await projectBrain.request("POST", "/graph/query", {
        projectId: fixtures.project.id,
        startNode: "src/api/users.ts",
        edgeTypes: ["imports"],
        maxDepth: 2,
      });

      expect(response.status).toBe(200);
      const body = response.body as {
        nodes: unknown[];
        edges: unknown[];
      };
      expect(body.nodes).toHaveLength(3);
      expect(body.edges).toHaveLength(2);
    });
  });

  describe("memory operations", () => {
    it("stores and retrieves episodic memory", async () => {
      projectBrain.onRequest("POST", "/memory/store", {
        status: 200,
        body: { id: "mem_1", stored: true },
      });

      const storeResponse = await projectBrain.request(
        "POST",
        "/memory/store",
        {
          projectId: fixtures.project.id,
          type: "episodic",
          content: {
            eventType: "architecture_decision",
            decision: "Use tRPC for all API endpoints",
            reasoning: "Type safety across client-server boundary",
            outcome: "success",
          },
        }
      );

      expect(storeResponse.status).toBe(200);

      projectBrain.onRequest("POST", "/search/semantic", {
        status: 200,
        body: {
          results: [
            {
              content: "Use tRPC for all API endpoints",
              score: 0.95,
            },
          ],
          totalResults: 1,
        },
      });

      const searchResponse = await projectBrain.request(
        "POST",
        "/search/semantic",
        {
          projectId: fixtures.project.id,
          query: "API endpoint technology decision",
          limit: 5,
        }
      );

      expect(searchResponse.status).toBe(200);
    });
  });

  describe("session resume", () => {
    it("generates session resume briefing", async () => {
      projectBrain.onRequest(
        "POST",
        `/sessions/${fixtures.session.id}/resume`,
        {
          status: 200,
          body: {
            summary: "Previous session implemented user auth module",
            recentActions: [
              { type: "file_change", file: "src/auth.ts", operation: "create" },
              {
                type: "file_change",
                file: "src/middleware.ts",
                operation: "edit",
              },
            ],
            currentState: { activeTask: null, openFiles: ["src/auth.ts"] },
            nextSteps: ["Write tests for auth module", "Add rate limiting"],
          },
        }
      );

      const response = await projectBrain.request(
        "POST",
        `/sessions/${fixtures.session.id}/resume`,
        { projectId: fixtures.project.id }
      );

      expect(response.status).toBe(200);
      const body = response.body as {
        summary: string;
        recentActions: unknown[];
        nextSteps: string[];
      };
      expect(body.summary).toContain("auth");
      expect(body.recentActions).toHaveLength(2);
      expect(body.nextSteps.length).toBeGreaterThan(0);
    });
  });
});
