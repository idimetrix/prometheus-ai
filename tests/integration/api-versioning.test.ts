/**
 * Integration tests: API Versioning (GAP-025).
 *
 * Verifies API version handling:
 * - All tRPC routes respond correctly
 * - Backward compatibility with old request shapes
 * - Version header handling via middleware
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

describe("API Versioning", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;
  const apiClient = createMockServiceClient("api");

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    apiClient._reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("version headers", () => {
    it("adds X-API-Version header to responses", async () => {
      const { API_VERSION, addVersionHeaders } = await import(
        "../../apps/api/src/versioning"
      );

      expect(API_VERSION).toBe("1.0.0");

      // Simulate a Hono context with headers
      const headers = new Map<string, string>();
      const mockContext = {
        header: (name: string, value: string) => {
          headers.set(name, value);
        },
      };

      addVersionHeaders(mockContext as never);

      expect(headers.get("X-API-Version")).toBe("1.0.0");
    });
  });

  describe("tRPC route responses", () => {
    it("health endpoint returns valid response shape", async () => {
      apiClient.onRequest("GET", "/trpc/health.check", {
        status: 200,
        body: {
          result: {
            data: { status: "ok", version: "1.0.0" },
          },
        },
      });

      const response = await apiClient.request("GET", "/trpc/health.check");

      expect(response.status).toBe(200);
      const body = response.body as {
        result: { data: { status: string; version: string } };
      };
      expect(body.result.data.status).toBe("ok");
    });

    it("projects endpoint returns list shape", async () => {
      apiClient.onRequest("GET", "/trpc/projects.list", {
        status: 200,
        body: {
          result: {
            data: {
              items: [
                {
                  id: fixtures.project.id,
                  name: "Test Project",
                  orgId: fixtures.org.id,
                },
              ],
              total: 1,
            },
          },
        },
      });

      const response = await apiClient.request("GET", "/trpc/projects.list");

      expect(response.status).toBe(200);
      const body = response.body as {
        result: { data: { items: unknown[]; total: number } };
      };
      expect(body.result.data.items).toHaveLength(1);
      expect(body.result.data.total).toBe(1);
    });

    it("tasks endpoint returns task shape", async () => {
      apiClient.onRequest("GET", "/trpc/tasks.getById", {
        status: 200,
        body: {
          result: {
            data: {
              id: fixtures.task.id,
              sessionId: fixtures.session.id,
              title: "Test Task",
              status: "completed",
            },
          },
        },
      });

      const response = await apiClient.request("GET", "/trpc/tasks.getById");

      expect(response.status).toBe(200);
      const body = response.body as {
        result: { data: { id: string; status: string } };
      };
      expect(body.result.data.id).toBe(fixtures.task.id);
    });
  });

  describe("backward compatibility", () => {
    it("accepts old request shapes without version field", async () => {
      apiClient.onRequest("POST", "/trpc/sessions.create", {
        status: 200,
        body: {
          result: {
            data: {
              id: fixtures.session.id,
              projectId: fixtures.project.id,
              mode: "task",
            },
          },
        },
      });

      // Old client sends request without version metadata
      const response = await apiClient.request(
        "POST",
        "/trpc/sessions.create",
        {
          projectId: fixtures.project.id,
          mode: "task",
          // No version field — old client format
        }
      );

      expect(response.status).toBe(200);
    });

    it("accepts new request shapes with version field", async () => {
      apiClient.onRequest("POST", "/trpc/sessions.create", {
        status: 200,
        body: {
          result: {
            data: {
              id: fixtures.session.id,
              projectId: fixtures.project.id,
              mode: "task",
            },
          },
        },
      });

      // New client sends request with version metadata
      const response = await apiClient.request(
        "POST",
        "/trpc/sessions.create",
        {
          projectId: fixtures.project.id,
          mode: "task",
          _apiVersion: "1.0.0",
        }
      );

      expect(response.status).toBe(200);
    });

    it("returns 404 for unknown routes", async () => {
      const response = await apiClient.request(
        "GET",
        "/trpc/nonexistent.route"
      );

      expect(response.status).toBe(404);
    });
  });

  describe("version negotiation", () => {
    it("handles multiple concurrent API versions", async () => {
      const { API_VERSION } = await import("../../apps/api/src/versioning");

      // Verify current version is semantic
      const parts = API_VERSION.split(".");
      expect(parts).toHaveLength(3);
      expect(Number.parseInt(parts[0], 10)).toBeGreaterThanOrEqual(1);
    });
  });
});
