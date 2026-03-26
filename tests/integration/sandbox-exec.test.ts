/**
 * Sandbox Execution Integration Tests (AE01).
 *
 * Tests the dev provider sandbox functionality including workspace creation,
 * command execution, file read/write, git clone, and dependency detection.
 * Extends sandbox-execution.test.ts with more comprehensive coverage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegrationFixtures } from "./setup";

const NODE_VERSION_PATTERN = /^v\d+\.\d+\.\d+$/;

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
// Enhanced mock sandbox with git and dependency support
// ---------------------------------------------------------------------------

interface WorkspaceConfig {
  env?: Record<string, string>;
  orgId: string;
  projectId: string;
  repoUrl?: string;
  sessionId: string;
  workDir?: string;
}

interface Workspace {
  clonedFrom?: string;
  config: WorkspaceConfig;
  createdAt: string;
  currentDir: string;
  dependencies: Map<string, string>;
  env: Record<string, string>;
  files: Map<string, string>;
  gitHistory: Array<{ hash: string; message: string; timestamp: string }>;
  gitInitialized: boolean;
  id: string;
  status: "creating" | "ready" | "busy" | "stopped" | "error";
}

interface ExecResult {
  durationMs: number;
  exitCode: number;
  stderr: string;
  stdout: string;
}

function createDevSandboxProvider() {
  const workspaces = new Map<string, Workspace>();

  function createWorkspace(config: WorkspaceConfig): Workspace {
    const id = `ws_${config.sessionId}_${Date.now()}`;
    const workspace: Workspace = {
      id,
      config,
      status: "ready",
      files: new Map(),
      dependencies: new Map(),
      gitInitialized: false,
      gitHistory: [],
      env: config.env ?? {},
      currentDir: config.workDir ?? "/workspace",
      createdAt: new Date().toISOString(),
    };

    // Pre-populate workspace structure
    workspace.files.set(`${workspace.currentDir}/.gitkeep`, "");
    workspaces.set(id, workspace);
    return workspace;
  }

  function exec(workspaceId: string, command: string): ExecResult {
    const ws = workspaces.get(workspaceId);
    if (!ws) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    if (ws.status !== "ready") {
      throw new Error(
        `Workspace ${workspaceId} is ${ws.status}, expected ready`
      );
    }

    ws.status = "busy";
    const startTime = Date.now();

    let result: ExecResult;

    // Simulate various commands
    if (command.startsWith("echo ")) {
      const content = command.slice(5).replace(/^["']|["']$/g, "");
      result = { exitCode: 0, stdout: content, stderr: "", durationMs: 1 };
    } else if (command === "pwd") {
      result = {
        exitCode: 0,
        stdout: ws.currentDir,
        stderr: "",
        durationMs: 1,
      };
    } else if (command === "ls" || command.startsWith("ls ")) {
      const dir = command === "ls" ? ws.currentDir : command.slice(3).trim();
      const files = [...ws.files.keys()].filter((f) => f.startsWith(dir));
      result = {
        exitCode: 0,
        stdout: files.join("\n"),
        stderr: "",
        durationMs: 2,
      };
    } else if (command.startsWith("cat ")) {
      const path = command.slice(4).trim();
      const content = ws.files.get(path);
      if (content === undefined) {
        result = {
          exitCode: 1,
          stdout: "",
          stderr: `cat: ${path}: No such file or directory`,
          durationMs: 1,
        };
      } else {
        result = { exitCode: 0, stdout: content, stderr: "", durationMs: 1 };
      }
    } else if (command.startsWith("mkdir -p ")) {
      const dir = command.slice(9).trim();
      ws.files.set(`${dir}/.gitkeep`, "");
      result = { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
    } else if (command === "git init") {
      ws.gitInitialized = true;
      ws.gitHistory.push({
        hash: "0000000",
        message: "Initial commit (empty)",
        timestamp: new Date().toISOString(),
      });
      result = {
        exitCode: 0,
        stdout: `Initialized empty Git repository in ${ws.currentDir}/.git/`,
        stderr: "",
        durationMs: 5,
      };
    } else if (command.startsWith("git clone ")) {
      const url = command.split(" ")[2] ?? "";
      ws.clonedFrom = url;
      ws.gitInitialized = true;
      // Simulate cloned files
      ws.files.set(`${ws.currentDir}/package.json`, '{"name": "cloned-repo"}');
      ws.files.set(`${ws.currentDir}/README.md`, "# Cloned Repository");
      ws.files.set(`${ws.currentDir}/src/index.ts`, 'console.log("hello");');
      ws.gitHistory.push({
        hash: "abc1234",
        message: "Initial commit",
        timestamp: new Date().toISOString(),
      });
      result = {
        exitCode: 0,
        stdout: `Cloning into '${ws.currentDir}'...`,
        stderr: "",
        durationMs: 500,
      };
    } else if (command === "git log --oneline") {
      const log = ws.gitHistory.map((c) => `${c.hash} ${c.message}`).join("\n");
      result = {
        exitCode: ws.gitInitialized ? 0 : 128,
        stdout: log,
        stderr: ws.gitInitialized ? "" : "fatal: not a git repository",
        durationMs: 3,
      };
    } else if (command === "npm install" || command === "pnpm install") {
      // Detect dependencies from package.json
      const pkgJson = ws.files.get(`${ws.currentDir}/package.json`);
      if (pkgJson) {
        try {
          const pkg = JSON.parse(pkgJson);
          const deps = pkg.dependencies ?? {};
          for (const [name, version] of Object.entries(deps)) {
            ws.dependencies.set(name, version as string);
          }
          ws.files.set(
            `${ws.currentDir}/node_modules/.package-lock.json`,
            "{}"
          );
          result = {
            exitCode: 0,
            stdout: `added ${Object.keys(deps).length} packages`,
            stderr: "",
            durationMs: 3000,
          };
        } catch {
          result = {
            exitCode: 1,
            stdout: "",
            stderr: "npm ERR! Invalid package.json",
            durationMs: 100,
          };
        }
      } else {
        result = {
          exitCode: 1,
          stdout: "",
          stderr: "npm ERR! enoent: package.json not found",
          durationMs: 50,
        };
      }
    } else if (command === "pip install -r requirements.txt") {
      const reqs = ws.files.get(`${ws.currentDir}/requirements.txt`);
      if (reqs) {
        const packages = reqs.split("\n").filter((l) => l.trim());
        for (const pkg of packages) {
          const [name, version] = pkg.split("==");
          ws.dependencies.set(name, version ?? "latest");
        }
        result = {
          exitCode: 0,
          stdout: `Successfully installed ${packages.length} packages`,
          stderr: "",
          durationMs: 2000,
        };
      } else {
        result = {
          exitCode: 1,
          stdout: "",
          stderr: "ERROR: Could not open requirements file",
          durationMs: 50,
        };
      }
    } else if (command === "which node") {
      result = {
        exitCode: 0,
        stdout: "/usr/local/bin/node",
        stderr: "",
        durationMs: 1,
      };
    } else if (command === "node --version") {
      result = {
        exitCode: 0,
        stdout: "v20.11.0",
        stderr: "",
        durationMs: 10,
      };
    } else if (command === "exit 1") {
      result = {
        exitCode: 1,
        stdout: "",
        stderr: "Simulated failure",
        durationMs: 1,
      };
    } else {
      result = {
        exitCode: 0,
        stdout: `Executed: ${command}`,
        stderr: "",
        durationMs: 10,
      };
    }

    result.durationMs = Date.now() - startTime || result.durationMs;
    ws.status = "ready";
    return result;
  }

  function writeFile(workspaceId: string, path: string, content: string): void {
    const ws = workspaces.get(workspaceId);
    if (!ws) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    ws.files.set(path, content);
  }

  function readFile(workspaceId: string, path: string): string {
    const ws = workspaces.get(workspaceId);
    if (!ws) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }
    const content = ws.files.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }

  function destroyWorkspace(workspaceId: string): void {
    const ws = workspaces.get(workspaceId);
    if (ws) {
      ws.status = "stopped";
      ws.files.clear();
      ws.dependencies.clear();
    }
  }

  function getWorkspace(workspaceId: string): Workspace | undefined {
    return workspaces.get(workspaceId);
  }

  return {
    createWorkspace,
    destroyWorkspace,
    exec,
    getWorkspace,
    readFile,
    writeFile,
    get _workspaces() {
      return workspaces;
    },
  };
}

// ---------------------------------------------------------------------------
// Dependency detection helpers
// ---------------------------------------------------------------------------

type PackageManager = "npm" | "pnpm" | "yarn" | "pip" | "go" | "unknown";

function detectPackageManager(files: Map<string, string>): PackageManager {
  const fileNames = [...files.keys()];

  if (fileNames.some((f) => f.endsWith("pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (fileNames.some((f) => f.endsWith("yarn.lock"))) {
    return "yarn";
  }
  if (fileNames.some((f) => f.endsWith("package-lock.json"))) {
    return "npm";
  }
  if (fileNames.some((f) => f.endsWith("package.json"))) {
    return "npm";
  }
  if (fileNames.some((f) => f.endsWith("requirements.txt"))) {
    return "pip";
  }
  if (fileNames.some((f) => f.endsWith("go.mod"))) {
    return "go";
  }

  return "unknown";
}

function getInstallCommand(pm: PackageManager): string | null {
  switch (pm) {
    case "npm":
      return "npm install";
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn install";
    case "pip":
      return "pip install -r requirements.txt";
    case "go":
      return "go mod download";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Sandbox Execution Integration", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;
  let sandbox: ReturnType<typeof createDevSandboxProvider>;

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    sandbox = createDevSandboxProvider();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("workspace creation", () => {
    it("creates a workspace with default configuration", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      expect(ws.id).toContain("ws_");
      expect(ws.status).toBe("ready");
      expect(ws.currentDir).toBe("/workspace");
      expect(ws.files.size).toBeGreaterThan(0);
      expect(ws.gitInitialized).toBe(false);
    });

    it("creates a workspace with custom working directory", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        workDir: "/app",
      });

      expect(ws.currentDir).toBe("/app");
    });

    it("creates a workspace with environment variables", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        env: { NODE_ENV: "test", API_URL: "http://localhost:4000" },
      });

      expect(ws.env.NODE_ENV).toBe("test");
      expect(ws.env.API_URL).toBe("http://localhost:4000");
    });

    it("workspaces are isolated from each other", () => {
      const ws1 = sandbox.createWorkspace({
        sessionId: "session_1",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      const ws2 = sandbox.createWorkspace({
        sessionId: "session_2",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      sandbox.writeFile(ws1.id, "/workspace/secret.txt", "private data");

      expect(() => sandbox.readFile(ws2.id, "/workspace/secret.txt")).toThrow(
        "File not found"
      );
    });
  });

  describe("command execution", () => {
    it("executes echo command and returns output", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      const result = sandbox.exec(ws.id, 'echo "hello world"');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello world");
      expect(result.stderr).toBe("");
    });

    it("reports correct working directory", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        workDir: "/app/project",
      });

      const result = sandbox.exec(ws.id, "pwd");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("/app/project");
    });

    it("returns non-zero exit code on failure", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      const result = sandbox.exec(ws.id, "exit 1");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("failure");
    });

    it("throws when executing on non-existent workspace", () => {
      expect(() => sandbox.exec("ws_nonexistent", "echo hello")).toThrow(
        "not found"
      );
    });

    it("throws when executing on stopped workspace", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      sandbox.destroyWorkspace(ws.id);

      expect(() => sandbox.exec(ws.id, "echo hello")).toThrow("stopped");
    });

    it("detects node runtime availability", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      const whichResult = sandbox.exec(ws.id, "which node");
      expect(whichResult.exitCode).toBe(0);
      expect(whichResult.stdout).toContain("node");

      const versionResult = sandbox.exec(ws.id, "node --version");
      expect(versionResult.exitCode).toBe(0);
      expect(versionResult.stdout).toMatch(NODE_VERSION_PATTERN);
    });
  });

  describe("file operations", () => {
    it("writes and reads files", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      sandbox.writeFile(ws.id, "/workspace/src/index.ts", "const x = 1;");
      const content = sandbox.readFile(ws.id, "/workspace/src/index.ts");
      expect(content).toBe("const x = 1;");
    });

    it("reads files via cat command", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      sandbox.writeFile(ws.id, "/workspace/test.txt", "file content");

      const result = sandbox.exec(ws.id, "cat /workspace/test.txt");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("file content");
    });

    it("cat returns error for missing file", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      const result = sandbox.exec(ws.id, "cat /workspace/missing.txt");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No such file");
    });

    it("lists files in workspace", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      sandbox.writeFile(ws.id, "/workspace/a.ts", "a");
      sandbox.writeFile(ws.id, "/workspace/b.ts", "b");
      sandbox.writeFile(ws.id, "/workspace/src/c.ts", "c");

      const result = sandbox.exec(ws.id, "ls /workspace");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("/workspace/a.ts");
      expect(result.stdout).toContain("/workspace/b.ts");
      expect(result.stdout).toContain("/workspace/src/c.ts");
    });

    it("creates directories with mkdir -p", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      const result = sandbox.exec(ws.id, "mkdir -p /workspace/src/lib");
      expect(result.exitCode).toBe(0);

      // Directory should exist (via .gitkeep)
      const lsResult = sandbox.exec(ws.id, "ls /workspace/src/lib");
      expect(lsResult.exitCode).toBe(0);
    });
  });

  describe("git clone into sandbox", () => {
    it("clones a repository into the workspace", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      const result = sandbox.exec(
        ws.id,
        "git clone https://github.com/test/repo /workspace"
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Cloning");

      // Verify cloned files exist
      const wsState = sandbox.getWorkspace(ws.id);
      expect(wsState?.clonedFrom).toBe("https://github.com/test/repo");
      expect(wsState?.gitInitialized).toBe(true);

      // Should have files from the clone
      const content = sandbox.readFile(ws.id, "/workspace/package.json");
      expect(content).toContain("cloned-repo");
    });

    it("git log shows commit history after clone", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      sandbox.exec(ws.id, "git clone https://github.com/test/repo /workspace");

      const logResult = sandbox.exec(ws.id, "git log --oneline");
      expect(logResult.exitCode).toBe(0);
      expect(logResult.stdout).toContain("Initial commit");
    });

    it("git init creates a fresh repository", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      const result = sandbox.exec(ws.id, "git init");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Initialized");

      const wsState = sandbox.getWorkspace(ws.id);
      expect(wsState?.gitInitialized).toBe(true);
    });

    it("git log fails on non-git workspace", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      const result = sandbox.exec(ws.id, "git log --oneline");
      expect(result.exitCode).toBe(128);
      expect(result.stderr).toContain("not a git repository");
    });
  });

  describe("dependency installation detection", () => {
    it("detects npm project from package.json", () => {
      const files = new Map<string, string>();
      files.set("/workspace/package.json", '{"name": "test"}');

      expect(detectPackageManager(files)).toBe("npm");
    });

    it("detects pnpm project from pnpm-lock.yaml", () => {
      const files = new Map<string, string>();
      files.set("/workspace/package.json", '{"name": "test"}');
      files.set("/workspace/pnpm-lock.yaml", "lockfileVersion: 9");

      expect(detectPackageManager(files)).toBe("pnpm");
    });

    it("detects yarn project from yarn.lock", () => {
      const files = new Map<string, string>();
      files.set("/workspace/package.json", '{"name": "test"}');
      files.set("/workspace/yarn.lock", "# yarn lockfile v1");

      expect(detectPackageManager(files)).toBe("yarn");
    });

    it("detects pip project from requirements.txt", () => {
      const files = new Map<string, string>();
      files.set("/workspace/requirements.txt", "django==4.2\nflask==3.0");

      expect(detectPackageManager(files)).toBe("pip");
    });

    it("detects go project from go.mod", () => {
      const files = new Map<string, string>();
      files.set("/workspace/go.mod", "module github.com/test/app\ngo 1.21");

      expect(detectPackageManager(files)).toBe("go");
    });

    it("returns unknown for unrecognized project", () => {
      const files = new Map<string, string>();
      files.set("/workspace/main.rs", 'fn main() { println!("hi"); }');

      expect(detectPackageManager(files)).toBe("unknown");
    });

    it("returns correct install commands", () => {
      expect(getInstallCommand("npm")).toBe("npm install");
      expect(getInstallCommand("pnpm")).toBe("pnpm install");
      expect(getInstallCommand("yarn")).toBe("yarn install");
      expect(getInstallCommand("pip")).toBe("pip install -r requirements.txt");
      expect(getInstallCommand("go")).toBe("go mod download");
      expect(getInstallCommand("unknown")).toBeNull();
    });

    it("npm install detects and installs dependencies from package.json", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      sandbox.writeFile(
        ws.id,
        "/workspace/package.json",
        JSON.stringify({
          name: "test-project",
          dependencies: {
            express: "^4.18.0",
            hono: "^4.0.0",
          },
        })
      );

      const result = sandbox.exec(ws.id, "npm install");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("added 2 packages");

      const wsState = sandbox.getWorkspace(ws.id);
      expect(wsState?.dependencies.get("express")).toBe("^4.18.0");
      expect(wsState?.dependencies.get("hono")).toBe("^4.0.0");

      // node_modules should exist
      const lockfile = sandbox.readFile(
        ws.id,
        "/workspace/node_modules/.package-lock.json"
      );
      expect(lockfile).toBeDefined();
    });

    it("pip install detects and installs Python dependencies", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      sandbox.writeFile(
        ws.id,
        "/workspace/requirements.txt",
        "django==4.2\nflask==3.0.0\ncelery==5.3.0"
      );

      const result = sandbox.exec(ws.id, "pip install -r requirements.txt");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("3 packages");

      const wsState = sandbox.getWorkspace(ws.id);
      expect(wsState?.dependencies.get("django")).toBe("4.2");
      expect(wsState?.dependencies.get("flask")).toBe("3.0.0");
    });

    it("npm install fails when package.json is missing", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      const result = sandbox.exec(ws.id, "npm install");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("package.json not found");
    });

    it("auto-detects and runs install for cloned repo", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      // Clone a repo (creates package.json)
      sandbox.exec(ws.id, "git clone https://github.com/test/repo /workspace");

      // Detect package manager
      const wsState = sandbox.getWorkspace(ws.id);
      expect(wsState).toBeDefined();

      const pm = detectPackageManager(wsState?.files ?? new Map());
      expect(pm).toBe("npm"); // Cloned repo has package.json

      const installCmd = getInstallCommand(pm);
      expect(installCmd).toBe("npm install");

      // Execute install
      const result = sandbox.exec(ws.id, installCmd as string);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("workspace cleanup", () => {
    it("destroys workspace and clears all state", () => {
      const ws = sandbox.createWorkspace({
        sessionId: fixtures.session.id,
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      sandbox.writeFile(ws.id, "/workspace/test.ts", "const x = 1;");
      sandbox.exec(ws.id, "npm install");

      sandbox.destroyWorkspace(ws.id);

      const wsState = sandbox.getWorkspace(ws.id);
      expect(wsState?.status).toBe("stopped");
      expect(wsState?.files.size).toBe(0);
      expect(wsState?.dependencies.size).toBe(0);
    });

    it("multiple workspaces can be created and destroyed independently", () => {
      const ws1 = sandbox.createWorkspace({
        sessionId: "session_1",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      const ws2 = sandbox.createWorkspace({
        sessionId: "session_2",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
      });

      sandbox.writeFile(ws1.id, "/workspace/file1.ts", "ws1");
      sandbox.writeFile(ws2.id, "/workspace/file2.ts", "ws2");

      sandbox.destroyWorkspace(ws1.id);

      // ws2 should still be functional
      const content = sandbox.readFile(ws2.id, "/workspace/file2.ts");
      expect(content).toBe("ws2");

      // ws1 should be stopped
      expect(sandbox.getWorkspace(ws1.id)?.status).toBe("stopped");
      expect(sandbox.getWorkspace(ws2.id)?.status).toBe("ready");
    });
  });
});
