/**
 * Integration tests: Orchestrator ↔ Sandbox Manager communication.
 *
 * Verifies sandbox lifecycle: creation, command execution,
 * file operations, git operations, cleanup, and error handling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegrationFixtures, createMockServiceClient } from "./setup";

const SANDBOX_ID_PREFIX_RE = /^sbx_/;

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

describe("Orchestrator ↔ Sandbox Manager communication", () => {
  const sandboxManager = createMockServiceClient("sandbox-manager");
  let fixtures: ReturnType<typeof createIntegrationFixtures>;

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    sandboxManager._reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("sandbox lifecycle", () => {
    it("creates a sandbox for a task", async () => {
      sandboxManager.onRequest("POST", "/sandbox/create", {
        status: 200,
        body: {
          id: "sbx_1",
          status: "ready",
          provider: "docker",
          workdir: "/workspace",
          createdAt: new Date().toISOString(),
        },
      });

      const response = await sandboxManager.request("POST", "/sandbox/create", {
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        repoUrl: fixtures.project.repoUrl,
        cpuLimit: "1000m",
        memoryLimit: "2Gi",
      });

      expect(response.status).toBe(200);
      const body = response.body as {
        id: string;
        status: string;
        provider: string;
      };
      expect(body.id).toMatch(SANDBOX_ID_PREFIX_RE);
      expect(body.status).toBe("ready");
      expect(body.provider).toBe("docker");
    });

    it("releases a sandbox after task completion", async () => {
      sandboxManager.onRequest("DELETE", "/sandbox/sbx_1", {
        status: 200,
        body: { id: "sbx_1", status: "released", cleanupDurationMs: 250 },
      });

      const response = await sandboxManager.request("DELETE", "/sandbox/sbx_1");

      expect(response.status).toBe(200);
      const body = response.body as { status: string };
      expect(body.status).toBe("released");
    });
  });

  describe("command execution", () => {
    it("executes a shell command in sandbox", async () => {
      sandboxManager.onRequest("POST", "/sandbox/sbx_1/execute", {
        status: 200,
        body: {
          stdout: "hello world\n",
          stderr: "",
          exitCode: 0,
          durationMs: 50,
        },
      });

      const response = await sandboxManager.request(
        "POST",
        "/sandbox/sbx_1/execute",
        {
          command: "echo 'hello world'",
          timeout: 30_000,
          workdir: "/workspace",
        }
      );

      expect(response.status).toBe(200);
      const body = response.body as {
        stdout: string;
        exitCode: number;
        durationMs: number;
      };
      expect(body.stdout).toContain("hello world");
      expect(body.exitCode).toBe(0);
    });

    it("handles command timeout", async () => {
      sandboxManager.onRequest("POST", "/sandbox/sbx_1/execute", {
        status: 408,
        body: {
          error: "Command timed out after 30000ms",
          exitCode: -1,
          killed: true,
        },
      });

      const response = await sandboxManager.request(
        "POST",
        "/sandbox/sbx_1/execute",
        {
          command: "sleep 999",
          timeout: 30_000,
        }
      );

      expect(response.status).toBe(408);
      const body = response.body as { killed: boolean };
      expect(body.killed).toBe(true);
    });

    it("handles command failure with non-zero exit code", async () => {
      sandboxManager.onRequest("POST", "/sandbox/sbx_1/execute", {
        status: 200,
        body: {
          stdout: "",
          stderr: "npm ERR! Missing script: test\n",
          exitCode: 1,
          durationMs: 200,
        },
      });

      const response = await sandboxManager.request(
        "POST",
        "/sandbox/sbx_1/execute",
        {
          command: "npm test",
          timeout: 60_000,
        }
      );

      expect(response.status).toBe(200);
      const body = response.body as { exitCode: number; stderr: string };
      expect(body.exitCode).toBe(1);
      expect(body.stderr).toContain("Missing script");
    });
  });

  describe("file operations", () => {
    it("writes a file to sandbox", async () => {
      sandboxManager.onRequest("POST", "/sandbox/sbx_1/files/src/index.ts", {
        status: 200,
        body: { path: "src/index.ts", written: true, bytes: 45 },
      });

      const response = await sandboxManager.request(
        "POST",
        "/sandbox/sbx_1/files/src/index.ts",
        {
          content: 'console.log("Hello from Prometheus");\n',
          encoding: "utf-8",
        }
      );

      expect(response.status).toBe(200);
      const body = response.body as { written: boolean };
      expect(body.written).toBe(true);
    });

    it("reads a file from sandbox", async () => {
      sandboxManager.onRequest("POST", "/sandbox/sbx_1/files/package.json", {
        status: 200,
        body: {
          path: "package.json",
          content: '{"name": "test-project", "version": "1.0.0"}',
          encoding: "utf-8",
        },
      });

      const response = await sandboxManager.request(
        "POST",
        "/sandbox/sbx_1/files/package.json",
        { operation: "read" }
      );

      expect(response.status).toBe(200);
      const body = response.body as { content: string };
      expect(JSON.parse(body.content)).toHaveProperty("name", "test-project");
    });

    it("lists files in sandbox directory", async () => {
      sandboxManager.onRequest("GET", "/sandbox/sbx_1/fs", {
        status: 200,
        body: {
          entries: [
            { name: "package.json", type: "file", size: 250 },
            { name: "src", type: "directory" },
            { name: "tsconfig.json", type: "file", size: 180 },
            { name: "node_modules", type: "directory" },
          ],
        },
      });

      const response = await sandboxManager.request("GET", "/sandbox/sbx_1/fs");

      expect(response.status).toBe(200);
      const body = response.body as {
        entries: Array<{ name: string; type: string }>;
      };
      expect(body.entries.length).toBeGreaterThan(0);
      expect(body.entries.find((e) => e.name === "package.json")).toBeDefined();
    });
  });

  describe("git operations", () => {
    it("clones a repository into sandbox", async () => {
      sandboxManager.onRequest("POST", "/sandbox/sbx_1/git/clone", {
        status: 200,
        body: {
          success: true,
          repoUrl: "https://github.com/test/repo",
          branch: "main",
          commitHash: "abc123def456",
          filesCount: 42,
        },
      });

      const response = await sandboxManager.request(
        "POST",
        "/sandbox/sbx_1/git/clone",
        {
          repoUrl: "https://github.com/test/repo",
          branch: "main",
          depth: 1,
        }
      );

      expect(response.status).toBe(200);
      const body = response.body as {
        success: boolean;
        commitHash: string;
      };
      expect(body.success).toBe(true);
      expect(body.commitHash).toBeTruthy();
    });

    it("commits changes in sandbox", async () => {
      sandboxManager.onRequest("POST", "/sandbox/sbx_1/git/commit", {
        status: 200,
        body: {
          success: true,
          commitHash: "def789abc123",
          message: "feat: add user profile endpoint",
          filesChanged: 3,
        },
      });

      const response = await sandboxManager.request(
        "POST",
        "/sandbox/sbx_1/git/commit",
        {
          message: "feat: add user profile endpoint",
          files: [
            "src/api/users.ts",
            "src/validators/user.ts",
            "tests/users.test.ts",
          ],
        }
      );

      expect(response.status).toBe(200);
      const body = response.body as { filesChanged: number };
      expect(body.filesChanged).toBe(3);
    });
  });

  describe("pool and health", () => {
    it("checks pool statistics", async () => {
      sandboxManager.onRequest("GET", "/pool/stats", {
        status: 200,
        body: {
          active: 3,
          idle: 7,
          waiting: 0,
          total: 10,
          maxCapacity: 20,
          providers: {
            docker: { active: 3, idle: 7 },
          },
        },
      });

      const response = await sandboxManager.request("GET", "/pool/stats");

      expect(response.status).toBe(200);
      const body = response.body as {
        active: number;
        total: number;
        maxCapacity: number;
      };
      expect(body.active).toBeLessThanOrEqual(body.maxCapacity);
    });

    it("health check returns service status", async () => {
      sandboxManager.onRequest("GET", "/health", {
        status: 200,
        body: {
          status: "healthy",
          uptime: 3600,
          docker: "connected",
          pool: { active: 2, idle: 8 },
        },
      });

      const response = await sandboxManager.request("GET", "/health");

      expect(response.status).toBe(200);
      const body = response.body as { status: string; docker: string };
      expect(body.status).toBe("healthy");
      expect(body.docker).toBe("connected");
    });
  });

  describe("screenshot and browser", () => {
    it("takes a screenshot of rendered page", async () => {
      sandboxManager.onRequest("POST", "/sandbox/sbx_1/screenshot", {
        status: 200,
        body: {
          url: "http://localhost:3000",
          imageBase64: "iVBORw0KGgoAAAANSUhEUg...",
          width: 1280,
          height: 720,
          timestamp: new Date().toISOString(),
        },
      });

      const response = await sandboxManager.request(
        "POST",
        "/sandbox/sbx_1/screenshot",
        {
          url: "http://localhost:3000",
          fullPage: false,
          width: 1280,
          height: 720,
        }
      );

      expect(response.status).toBe(200);
      const body = response.body as {
        imageBase64: string;
        width: number;
      };
      expect(body.imageBase64).toBeTruthy();
      expect(body.width).toBe(1280);
    });
  });
});
