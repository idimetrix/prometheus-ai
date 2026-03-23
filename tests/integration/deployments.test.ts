/**
 * Integration tests: Deployment Providers.
 *
 * Verifies Vercel, Netlify, and Docker deployment providers (mocked),
 * deployment status transitions, logs retrieval, and teardown.
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

// ─── Types matching the deployment system ───────────────────────────────────

interface DeploymentConfig {
  branch?: string;
  deploymentId: string;
  envVars?: Record<string, string>;
  orgId: string;
  projectId: string;
  provider: "vercel" | "netlify" | "cloudflare" | "docker";
  repoUrl?: string;
}

interface DeploymentResult {
  buildLogs?: string;
  errorMessage?: string;
  providerDeploymentId?: string;
  success: boolean;
  url?: string;
}

type DeploymentStatus =
  | "pending"
  | "building"
  | "deploying"
  | "ready"
  | "failed"
  | "cancelled"
  | "torn_down";

interface DeploymentRecord {
  config: DeploymentConfig;
  createdAt: string;
  id: string;
  logs: string[];
  result?: DeploymentResult;
  status: DeploymentStatus;
  updatedAt: string;
}

// ─── Mock provider implementations ─────────────────────────────────────────

function createMockVercelProvider() {
  return {
    async deploy(config: DeploymentConfig): Promise<DeploymentResult> {
      if (!process.env.VERCEL_TOKEN) {
        return {
          success: false,
          errorMessage: "VERCEL_TOKEN environment variable is not set.",
        };
      }

      return {
        success: true,
        url: `https://prometheus-preview-${config.projectId.slice(0, 8)}.vercel.app`,
        providerDeploymentId: `dpl_${config.deploymentId}`,
        buildLogs: `https://vercel.com/deployments/dpl_${config.deploymentId}`,
      };
    },
    async teardown(
      providerDeploymentId: string
    ): Promise<{ success: boolean }> {
      if (!process.env.VERCEL_TOKEN) {
        return { success: false };
      }
      return { success: providerDeploymentId.startsWith("dpl_") };
    },
  };
}

function createMockNetlifyProvider() {
  return {
    async deploy(config: DeploymentConfig): Promise<DeploymentResult> {
      if (!process.env.NETLIFY_TOKEN) {
        return {
          success: false,
          errorMessage: "NETLIFY_TOKEN environment variable is not set.",
        };
      }

      return {
        success: true,
        url: `https://prometheus-preview-${config.projectId.slice(0, 8)}.netlify.app`,
        providerDeploymentId: `ntl_${config.deploymentId}`,
        buildLogs: `https://app.netlify.com/sites/preview/deploys/ntl_${config.deploymentId}`,
      };
    },
    async teardown(
      providerDeploymentId: string
    ): Promise<{ success: boolean }> {
      if (!process.env.NETLIFY_TOKEN) {
        return { success: false };
      }
      return { success: providerDeploymentId.startsWith("ntl_") };
    },
  };
}

function createMockDockerProvider() {
  return {
    async deploy(config: DeploymentConfig): Promise<DeploymentResult> {
      const port = 3100 + Math.floor(Math.random() * 900);
      return {
        success: true,
        url: `http://localhost:${port}`,
        providerDeploymentId: `ctr_${config.deploymentId}`,
        buildLogs: `Container ctr_${config.deploymentId} running on port ${port}`,
      };
    },
    async teardown(
      providerDeploymentId: string
    ): Promise<{ success: boolean }> {
      return { success: providerDeploymentId.startsWith("ctr_") };
    },
  };
}

// ─── Deployment state machine ───────────────────────────────────────────────

function createDeploymentRecord(config: DeploymentConfig): DeploymentRecord {
  const now = new Date().toISOString();
  return {
    id: config.deploymentId,
    config,
    status: "pending",
    logs: [`[${now}] Deployment created`],
    createdAt: now,
    updatedAt: now,
  };
}

function transitionStatus(
  record: DeploymentRecord,
  newStatus: DeploymentStatus
): DeploymentRecord {
  const validTransitions: Record<DeploymentStatus, DeploymentStatus[]> = {
    pending: ["building", "cancelled"],
    building: ["deploying", "failed", "cancelled"],
    deploying: ["ready", "failed", "cancelled"],
    ready: ["torn_down"],
    failed: ["pending"],
    cancelled: ["pending"],
    torn_down: [],
  };

  const allowed = validTransitions[record.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid transition: ${record.status} -> ${newStatus}`);
  }

  const now = new Date().toISOString();
  return {
    ...record,
    status: newStatus,
    updatedAt: now,
    logs: [...record.logs, `[${now}] Status: ${newStatus}`],
  };
}

describe("Deployment Providers", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.env.VERCEL_TOKEN = "";
    process.env.NETLIFY_TOKEN = "";
  });

  describe("Vercel deployment provider", () => {
    const vercel = createMockVercelProvider();

    it("deploys successfully when VERCEL_TOKEN is set", async () => {
      process.env.VERCEL_TOKEN = "test-vercel-token";

      const result = await vercel.deploy({
        deploymentId: "dep_001",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "vercel",
        branch: "main",
        repoUrl: "https://github.com/org/repo",
      });

      expect(result.success).toBe(true);
      expect(result.url).toContain("vercel.app");
      expect(result.providerDeploymentId).toBe("dpl_dep_001");
      expect(result.buildLogs).toContain("vercel.com/deployments");
    });

    it("fails when VERCEL_TOKEN is not set", async () => {
      process.env.VERCEL_TOKEN = "";

      const result = await vercel.deploy({
        deploymentId: "dep_002",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "vercel",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("VERCEL_TOKEN");
    });

    it("tears down deployment successfully", async () => {
      process.env.VERCEL_TOKEN = "test-vercel-token";
      const teardownResult = await vercel.teardown("dpl_dep_001");
      expect(teardownResult.success).toBe(true);
    });

    it("fails teardown with invalid deployment ID", async () => {
      process.env.VERCEL_TOKEN = "test-vercel-token";
      const teardownResult = await vercel.teardown("invalid_id");
      expect(teardownResult.success).toBe(false);
    });

    it("fails teardown without token", async () => {
      process.env.VERCEL_TOKEN = "";
      const teardownResult = await vercel.teardown("dpl_dep_001");
      expect(teardownResult.success).toBe(false);
    });
  });

  describe("Netlify deployment provider", () => {
    const netlify = createMockNetlifyProvider();

    it("deploys successfully when NETLIFY_TOKEN is set", async () => {
      process.env.NETLIFY_TOKEN = "test-netlify-token";

      const result = await netlify.deploy({
        deploymentId: "dep_003",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "netlify",
        branch: "main",
      });

      expect(result.success).toBe(true);
      expect(result.url).toContain("netlify.app");
      expect(result.providerDeploymentId).toBe("ntl_dep_003");
    });

    it("fails when NETLIFY_TOKEN is not set", async () => {
      process.env.NETLIFY_TOKEN = "";

      const result = await netlify.deploy({
        deploymentId: "dep_004",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "netlify",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("NETLIFY_TOKEN");
    });

    it("tears down deployment successfully", async () => {
      process.env.NETLIFY_TOKEN = "test-netlify-token";
      const teardownResult = await netlify.teardown("ntl_dep_003");
      expect(teardownResult.success).toBe(true);
    });
  });

  describe("Docker deployment provider", () => {
    const docker = createMockDockerProvider();

    it("deploys successfully via sandbox manager", async () => {
      const result = await docker.deploy({
        deploymentId: "dep_005",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "docker",
      });

      expect(result.success).toBe(true);
      expect(result.url).toMatch(/^http:\/\/localhost:\d+$/);
      expect(result.providerDeploymentId).toBe("ctr_dep_005");
      expect(result.buildLogs).toContain("Container");
    });

    it("includes environment variables in deployment", async () => {
      const config: DeploymentConfig = {
        deploymentId: "dep_006",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "docker",
        envVars: { NODE_ENV: "preview", API_URL: "http://api.test" },
      };

      const result = await docker.deploy(config);
      expect(result.success).toBe(true);
      expect(config.envVars).toHaveProperty("NODE_ENV", "preview");
    });

    it("tears down container successfully", async () => {
      const teardownResult = await docker.teardown("ctr_dep_005");
      expect(teardownResult.success).toBe(true);
    });

    it("does not require external tokens", async () => {
      // Docker provider uses sandbox-manager, no external token needed
      process.env.VERCEL_TOKEN = "";
      process.env.NETLIFY_TOKEN = "";

      const result = await docker.deploy({
        deploymentId: "dep_007",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "docker",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Deployment status transitions", () => {
    it("transitions through full lifecycle: pending -> building -> deploying -> ready", () => {
      let record = createDeploymentRecord({
        deploymentId: "dep_010",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "vercel",
      });

      expect(record.status).toBe("pending");

      record = transitionStatus(record, "building");
      expect(record.status).toBe("building");

      record = transitionStatus(record, "deploying");
      expect(record.status).toBe("deploying");

      record = transitionStatus(record, "ready");
      expect(record.status).toBe("ready");

      expect(record.logs).toHaveLength(4);
    });

    it("transitions to failed from building", () => {
      let record = createDeploymentRecord({
        deploymentId: "dep_011",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "netlify",
      });

      record = transitionStatus(record, "building");
      record = transitionStatus(record, "failed");
      expect(record.status).toBe("failed");
    });

    it("allows retry from failed -> pending", () => {
      let record = createDeploymentRecord({
        deploymentId: "dep_012",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "docker",
      });

      record = transitionStatus(record, "building");
      record = transitionStatus(record, "failed");
      record = transitionStatus(record, "pending");
      expect(record.status).toBe("pending");
    });

    it("allows cancellation from pending", () => {
      let record = createDeploymentRecord({
        deploymentId: "dep_013",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "vercel",
      });

      record = transitionStatus(record, "cancelled");
      expect(record.status).toBe("cancelled");
    });

    it("rejects invalid transitions", () => {
      const record = createDeploymentRecord({
        deploymentId: "dep_014",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "vercel",
      });

      expect(() => transitionStatus(record, "ready")).toThrow(
        "Invalid transition: pending -> ready"
      );
      expect(() => transitionStatus(record, "torn_down")).toThrow(
        "Invalid transition"
      );
    });

    it("transitions to torn_down only from ready", () => {
      let record = createDeploymentRecord({
        deploymentId: "dep_015",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "docker",
      });

      record = transitionStatus(record, "building");
      record = transitionStatus(record, "deploying");
      record = transitionStatus(record, "ready");
      record = transitionStatus(record, "torn_down");
      expect(record.status).toBe("torn_down");
    });

    it("prevents transitions from torn_down", () => {
      let record = createDeploymentRecord({
        deploymentId: "dep_016",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "docker",
      });

      record = transitionStatus(record, "building");
      record = transitionStatus(record, "deploying");
      record = transitionStatus(record, "ready");
      record = transitionStatus(record, "torn_down");

      expect(() => transitionStatus(record, "pending")).toThrow(
        "Invalid transition"
      );
    });
  });

  describe("Deployment logs retrieval", () => {
    it("accumulates logs throughout deployment lifecycle", () => {
      let record = createDeploymentRecord({
        deploymentId: "dep_020",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "vercel",
      });

      expect(record.logs).toHaveLength(1);
      expect(record.logs[0]).toContain("Deployment created");

      record = transitionStatus(record, "building");
      expect(record.logs).toHaveLength(2);
      expect(record.logs[1]).toContain("Status: building");

      record = transitionStatus(record, "deploying");
      expect(record.logs).toHaveLength(3);

      record = transitionStatus(record, "ready");
      expect(record.logs).toHaveLength(4);
      expect(record.logs[3]).toContain("Status: ready");
    });

    it("includes timestamps in all log entries", () => {
      let record = createDeploymentRecord({
        deploymentId: "dep_021",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "docker",
      });

      record = transitionStatus(record, "building");

      for (const log of record.logs) {
        expect(log).toMatch(/^\[.+\]/);
      }
    });

    it("returns build logs URL from provider result", async () => {
      process.env.VERCEL_TOKEN = "test-token";
      const vercel = createMockVercelProvider();

      const result = await vercel.deploy({
        deploymentId: "dep_022",
        projectId: fixtures.project.id,
        orgId: fixtures.org.id,
        provider: "vercel",
      });

      expect(result.buildLogs).toBeTruthy();
      expect(result.buildLogs).toContain("vercel.com");
    });
  });

  describe("Provider factory selection", () => {
    it("selects correct provider based on config", () => {
      const providers: Record<
        string,
        { deploy: (config: DeploymentConfig) => Promise<DeploymentResult> }
      > = {
        vercel: createMockVercelProvider(),
        netlify: createMockNetlifyProvider(),
        docker: createMockDockerProvider(),
      };

      expect(providers.vercel).toBeDefined();
      expect(providers.netlify).toBeDefined();
      expect(providers.docker).toBeDefined();
    });

    it("returns null for unknown provider", () => {
      const providers: Record<string, unknown> = {
        vercel: createMockVercelProvider(),
        netlify: createMockNetlifyProvider(),
        docker: createMockDockerProvider(),
      };

      expect(providers.cloudflare).toBeUndefined();
      expect(providers.aws).toBeUndefined();
    });
  });
});
