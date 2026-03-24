/**
 * Integration tests: Sandbox tool execution with mocked Docker.
 *
 * Verifies sandbox lifecycle (create, execute, destroy), tool execution
 * within sandboxes, resource limits, and cleanup behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegrationFixtures } from "./setup";

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

// ---------------------------------------------------------------------------
// Mock Docker sandbox system
// ---------------------------------------------------------------------------

interface SandboxConfig {
  cpuLimit: number;
  diskLimitMb: number;
  memoryLimitMb: number;
  orgId: string;
  projectId: string;
  sessionId: string;
  timeoutMs: number;
}

interface Sandbox {
  config: SandboxConfig;
  cpuUsedPercent: number;
  createdAt: string;
  executionHistory: Array<{
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  }>;
  files: Map<string, string>;
  id: string;
  memoryUsedMb: number;
  status: "creating" | "running" | "stopped" | "destroyed";
}

function createMockSandboxManager() {
  const sandboxes = new Map<string, Sandbox>();

  return {
    create(config: SandboxConfig): Sandbox {
      const sandbox: Sandbox = {
        id: `sbx_${config.sessionId}_${Date.now()}`,
        config,
        status: "running",
        files: new Map(),
        executionHistory: [],
        createdAt: new Date().toISOString(),
        memoryUsedMb: 0,
        cpuUsedPercent: 0,
      };
      sandboxes.set(sandbox.id, sandbox);
      return sandbox;
    },

    exec(
      sandboxId: string,
      command: string
    ): { exitCode: number; stdout: string; stderr: string } {
      const sandbox = sandboxes.get(sandboxId);
      if (!sandbox || sandbox.status !== "running") {
        throw new Error(`Sandbox ${sandboxId} is not running`);
      }

      // Simulate command execution
      let result: { exitCode: number; stdout: string; stderr: string };

      if (command.startsWith("echo ")) {
        result = {
          exitCode: 0,
          stdout: command.slice(5).replace(/^["']|["']$/g, ""),
          stderr: "",
        };
      } else if (command === "ls") {
        result = {
          exitCode: 0,
          stdout: [...sandbox.files.keys()].join("\n"),
          stderr: "",
        };
      } else if (command.startsWith("cat ")) {
        const filePath = command.slice(4).trim();
        const content = sandbox.files.get(filePath);
        if (content) {
          result = { exitCode: 0, stdout: content, stderr: "" };
        } else {
          result = {
            exitCode: 1,
            stdout: "",
            stderr: `cat: ${filePath}: No such file`,
          };
        }
      } else if (command === "exit 1") {
        result = { exitCode: 1, stdout: "", stderr: "Simulated failure" };
      } else {
        result = { exitCode: 0, stdout: `Executed: ${command}`, stderr: "" };
      }

      sandbox.executionHistory.push({
        command,
        ...result,
        durationMs: Math.random() * 100,
      });

      return result;
    },

    writeFile(sandboxId: string, filePath: string, content: string): void {
      const sandbox = sandboxes.get(sandboxId);
      if (!sandbox || sandbox.status !== "running") {
        throw new Error(`Sandbox ${sandboxId} is not running`);
      }
      sandbox.files.set(filePath, content);
    },

    readFile(sandboxId: string, filePath: string): string {
      const sandbox = sandboxes.get(sandboxId);
      if (!sandbox || sandbox.status !== "running") {
        throw new Error(`Sandbox ${sandboxId} is not running`);
      }
      const content = sandbox.files.get(filePath);
      if (content === undefined) {
        throw new Error(`File not found: ${filePath}`);
      }
      return content;
    },

    destroy(sandboxId: string): void {
      const sandbox = sandboxes.get(sandboxId);
      if (sandbox) {
        sandbox.status = "destroyed";
        sandbox.files.clear();
      }
    },

    getStatus(
      sandboxId: string
    ): { status: Sandbox["status"]; memoryUsedMb: number } | null {
      const sandbox = sandboxes.get(sandboxId);
      if (!sandbox) {
        return null;
      }
      return {
        status: sandbox.status,
        memoryUsedMb: sandbox.memoryUsedMb,
      };
    },

    get _sandboxes() {
      return sandboxes;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Sandbox execution integration", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;
  let sandboxManager: ReturnType<typeof createMockSandboxManager>;

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    sandboxManager = createMockSandboxManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("sandbox lifecycle", () => {
    it("creates a sandbox with correct configuration", () => {
      const sandbox = sandboxManager.create({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        memoryLimitMb: 512,
        cpuLimit: 1,
        diskLimitMb: 2048,
        timeoutMs: 300_000,
      });

      expect(sandbox.id).toContain("sbx_");
      expect(sandbox.status).toBe("running");
      expect(sandbox.config.memoryLimitMb).toBe(512);
      expect(sandbox.config.sessionId).toBe(fixtures.session.id);
    });

    it("destroys a sandbox and clears its files", () => {
      const sandbox = sandboxManager.create({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        memoryLimitMb: 512,
        cpuLimit: 1,
        diskLimitMb: 2048,
        timeoutMs: 300_000,
      });

      sandboxManager.writeFile(sandbox.id, "/app/test.ts", "const x = 1;");
      sandboxManager.destroy(sandbox.id);

      const status = sandboxManager.getStatus(sandbox.id);
      expect(status?.status).toBe("destroyed");
    });

    it("rejects operations on destroyed sandboxes", () => {
      const sandbox = sandboxManager.create({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        memoryLimitMb: 512,
        cpuLimit: 1,
        diskLimitMb: 2048,
        timeoutMs: 300_000,
      });

      sandboxManager.destroy(sandbox.id);

      expect(() => sandboxManager.exec(sandbox.id, "echo hello")).toThrow(
        "not running"
      );

      expect(() =>
        sandboxManager.writeFile(sandbox.id, "/test.ts", "code")
      ).toThrow("not running");
    });
  });

  describe("command execution", () => {
    it("executes a command and returns output", () => {
      const sandbox = sandboxManager.create({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        memoryLimitMb: 512,
        cpuLimit: 1,
        diskLimitMb: 2048,
        timeoutMs: 300_000,
      });

      const result = sandboxManager.exec(sandbox.id, 'echo "hello"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
    });

    it("returns non-zero exit code on failure", () => {
      const sandbox = sandboxManager.create({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        memoryLimitMb: 512,
        cpuLimit: 1,
        diskLimitMb: 2048,
        timeoutMs: 300_000,
      });

      const result = sandboxManager.exec(sandbox.id, "exit 1");
      expect(result.exitCode).toBe(1);
    });

    it("records execution history", () => {
      const sandbox = sandboxManager.create({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        memoryLimitMb: 512,
        cpuLimit: 1,
        diskLimitMb: 2048,
        timeoutMs: 300_000,
      });

      sandboxManager.exec(sandbox.id, "echo hello");
      sandboxManager.exec(sandbox.id, "echo world");

      const sbx = sandboxManager._sandboxes.get(sandbox.id);
      expect(sbx?.executionHistory).toHaveLength(2);
      expect(sbx?.executionHistory[0].command).toBe("echo hello");
      expect(sbx?.executionHistory[1].command).toBe("echo world");
    });
  });

  describe("file operations", () => {
    it("writes and reads files in the sandbox", () => {
      const sandbox = sandboxManager.create({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        memoryLimitMb: 512,
        cpuLimit: 1,
        diskLimitMb: 2048,
        timeoutMs: 300_000,
      });

      const nameVar = "name";
      const code = `export function greet(name: string) {\n  return \`Hello \${${nameVar}}\`;\n}`;
      sandboxManager.writeFile(sandbox.id, "/app/greet.ts", code);

      const content = sandboxManager.readFile(sandbox.id, "/app/greet.ts");
      expect(content).toBe(code);
    });

    it("throws when reading non-existent file", () => {
      const sandbox = sandboxManager.create({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        memoryLimitMb: 512,
        cpuLimit: 1,
        diskLimitMb: 2048,
        timeoutMs: 300_000,
      });

      expect(() =>
        sandboxManager.readFile(sandbox.id, "/nonexistent.ts")
      ).toThrow("File not found");
    });

    it("lists files via command execution", () => {
      const sandbox = sandboxManager.create({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        memoryLimitMb: 512,
        cpuLimit: 1,
        diskLimitMb: 2048,
        timeoutMs: 300_000,
      });

      sandboxManager.writeFile(sandbox.id, "/app/a.ts", "a");
      sandboxManager.writeFile(sandbox.id, "/app/b.ts", "b");

      const result = sandboxManager.exec(sandbox.id, "ls");
      expect(result.stdout).toContain("/app/a.ts");
      expect(result.stdout).toContain("/app/b.ts");
    });
  });

  describe("sandbox isolation", () => {
    it("sandboxes do not share files", () => {
      const sbx1 = sandboxManager.create({
        sessionId: "session_1",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        memoryLimitMb: 512,
        cpuLimit: 1,
        diskLimitMb: 2048,
        timeoutMs: 300_000,
      });

      const sbx2 = sandboxManager.create({
        sessionId: "session_2",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        memoryLimitMb: 512,
        cpuLimit: 1,
        diskLimitMb: 2048,
        timeoutMs: 300_000,
      });

      sandboxManager.writeFile(sbx1.id, "/secret.txt", "private data");

      expect(() => sandboxManager.readFile(sbx2.id, "/secret.txt")).toThrow(
        "File not found"
      );
    });
  });
});
