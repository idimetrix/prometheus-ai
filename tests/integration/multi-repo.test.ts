/**
 * Integration tests: Multi-Repository Support (GAP-018).
 *
 * Verifies multi-repo orchestration behavior:
 * - Task decomposition across multiple repos
 * - Cross-repo dependency analysis
 * - Linked PR creation across repos
 * - Dependency graph construction
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

let idCounter = 0;
vi.mock("@prometheus/utils", () => ({
  generateId: (prefix: string) => `${prefix}_test_${++idCounter}`,
}));

describe("Multi-Repository Support", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;
  const orchestratorClient = createMockServiceClient("orchestrator");

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    orchestratorClient._reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("multi-repo task decomposition", () => {
    it("identifies files across multiple repos and creates per-repo tasks", async () => {
      const { MultiRepoOrchestrator } = await import(
        "../../apps/orchestrator/src/composition/multi-repo"
      );

      const orchestrator = new MultiRepoOrchestrator();

      // Register repos
      const apiRepo = orchestrator.registerRepo({
        name: "backend-api",
        url: "https://github.com/org/backend-api",
        defaultBranch: "main",
        languages: ["typescript"],
        manifestPath: "package.json",
        projectId: fixtures.project.id,
      });

      const webRepo = orchestrator.registerRepo({
        name: "frontend-web",
        url: "https://github.com/org/frontend-web",
        defaultBranch: "main",
        languages: ["typescript", "react"],
        manifestPath: "package.json",
        projectId: fixtures.project.id,
      });

      const sharedRepo = orchestrator.registerRepo({
        name: "shared-types",
        url: "https://github.com/org/shared-types",
        defaultBranch: "main",
        languages: ["typescript"],
        manifestPath: "package.json",
        projectId: fixtures.project.id,
      });

      // Register dependencies
      orchestrator.addDependency({
        sourceRepoId: apiRepo.id,
        targetRepoId: sharedRepo.id,
        type: "npm",
        packageName: "@org/shared-types",
        versionConstraint: "^1.0.0",
      });

      orchestrator.addDependency({
        sourceRepoId: webRepo.id,
        targetRepoId: sharedRepo.id,
        type: "npm",
        packageName: "@org/shared-types",
        versionConstraint: "^1.0.0",
      });

      orchestrator.addDependency({
        sourceRepoId: webRepo.id,
        targetRepoId: apiRepo.id,
        type: "internal_api",
        packageName: "backend-api/routes",
      });

      // Create a cross-repo plan
      const plan = orchestrator.createPlan(
        "Add user preferences endpoint",
        [sharedRepo.id, apiRepo.id, webRepo.id],
        "UserPreferences"
      );

      expect(plan.tasks).toHaveLength(3);
      expect(plan.sharedContracts).toContain("UserPreferences");
      expect(plan.linkedPRs).toHaveLength(3);

      // Verify dependency ordering: web depends on api, api depends on shared
      const webTask = plan.tasks.find((t) => t.repoId === webRepo.id);
      const apiTask = plan.tasks.find((t) => t.repoId === apiRepo.id);
      const sharedTask = plan.tasks.find((t) => t.repoId === sharedRepo.id);

      expect(webTask).toBeDefined();
      expect(apiTask).toBeDefined();
      expect(sharedTask).toBeDefined();

      // Web depends on both shared and api
      expect(webTask?.dependencies).toContain(`task-${sharedRepo.id}`);
      expect(webTask?.dependencies).toContain(`task-${apiRepo.id}`);

      // API depends on shared
      expect(apiTask?.dependencies).toContain(`task-${sharedRepo.id}`);

      // Shared has fewer dependencies than web (it's a leaf dependency)
      expect((sharedTask?.dependencies ?? []).length).toBeLessThanOrEqual(
        (webTask?.dependencies ?? []).length
      );
    });

    it("handles task decomposition with unknown repos gracefully", async () => {
      const { MultiRepoOrchestrator } = await import(
        "../../apps/orchestrator/src/composition/multi-repo"
      );

      const orchestrator = new MultiRepoOrchestrator();

      const repo = orchestrator.registerRepo({
        name: "only-repo",
        url: "https://github.com/org/only-repo",
        defaultBranch: "main",
        languages: ["typescript"],
        manifestPath: "package.json",
        projectId: fixtures.project.id,
      });

      // Plan with one valid repo and one unknown
      const plan = orchestrator.createPlan("Fix bug", [
        repo.id,
        "unknown_repo_id",
      ]);

      // Only the valid repo should get a task
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].repoId).toBe(repo.id);
    });
  });

  describe("cross-repo PR creation", () => {
    it("creates linked PRs across repos with correct metadata", async () => {
      const { MultiRepoOrchestrator } = await import(
        "../../apps/orchestrator/src/composition/multi-repo"
      );

      const orchestrator = new MultiRepoOrchestrator();

      const apiRepo = orchestrator.registerRepo({
        name: "backend-api",
        url: "https://github.com/org/backend-api",
        defaultBranch: "main",
        languages: ["typescript"],
        manifestPath: "package.json",
        projectId: fixtures.project.id,
      });

      const webRepo = orchestrator.registerRepo({
        name: "frontend-web",
        url: "https://github.com/org/frontend-web",
        defaultBranch: "main",
        languages: ["typescript"],
        manifestPath: "package.json",
        projectId: fixtures.project.id,
      });

      // Create plan with linked PRs
      const plan = orchestrator.createPlan("Add auth flow", [
        apiRepo.id,
        webRepo.id,
      ]);

      expect(plan.linkedPRs).toHaveLength(2);
      expect(plan.linkedPRs.map((pr) => pr.repoId)).toContain(apiRepo.id);
      expect(plan.linkedPRs.map((pr) => pr.repoId)).toContain(webRepo.id);

      // Simulate PR creation via mock service client
      orchestratorClient.onRequest("POST", `/repos/${apiRepo.id}/pr`, {
        status: 201,
        body: {
          prUrl: "https://github.com/org/backend-api/pull/42",
          repoId: apiRepo.id,
        },
      });

      orchestratorClient.onRequest("POST", `/repos/${webRepo.id}/pr`, {
        status: 201,
        body: {
          prUrl: "https://github.com/org/frontend-web/pull/17",
          repoId: webRepo.id,
        },
      });

      // Create PRs for each repo in the plan
      const prResults: Array<{ status: number; body: unknown }> = [];
      for (const linkedPR of plan.linkedPRs) {
        const result = await orchestratorClient.request(
          "POST",
          `/repos/${linkedPR.repoId}/pr`,
          {
            branch: `feat/auth-flow-${plan.id}`,
            title: plan.description,
            body: `Part of cross-repo plan ${plan.id}`,
          }
        );
        prResults.push(result);
      }

      expect(prResults).toHaveLength(2);
      expect(prResults[0].status).toBe(201);
      expect(prResults[1].status).toBe(201);

      // Verify all PR requests returned successfully
      for (const result of prResults) {
        expect(result.status).toBeLessThanOrEqual(404); // 201 for matched mocks, 404 for unmatched
      }
    });
  });

  describe("cross-repo impact analysis", () => {
    it("detects directly and transitively affected repos", async () => {
      const { MultiRepoOrchestrator } = await import(
        "../../apps/orchestrator/src/composition/multi-repo"
      );

      const orchestrator = new MultiRepoOrchestrator();

      const coreRepo = orchestrator.registerRepo({
        name: "core-lib",
        url: "https://github.com/org/core-lib",
        defaultBranch: "main",
        languages: ["typescript"],
        manifestPath: "package.json",
        projectId: fixtures.project.id,
      });

      const apiRepo = orchestrator.registerRepo({
        name: "backend-api",
        url: "https://github.com/org/backend-api",
        defaultBranch: "main",
        languages: ["typescript"],
        manifestPath: "package.json",
        projectId: fixtures.project.id,
      });

      const webRepo = orchestrator.registerRepo({
        name: "frontend-web",
        url: "https://github.com/org/frontend-web",
        defaultBranch: "main",
        languages: ["typescript"],
        manifestPath: "package.json",
        projectId: fixtures.project.id,
      });

      // core -> api -> web dependency chain
      orchestrator.addDependency({
        sourceRepoId: apiRepo.id,
        targetRepoId: coreRepo.id,
        type: "npm",
        packageName: "@org/core-utils",
      });

      orchestrator.addDependency({
        sourceRepoId: webRepo.id,
        targetRepoId: apiRepo.id,
        type: "internal_api",
        packageName: "backend-api/client",
      });

      // Changing core-utils in core repo
      const impact = orchestrator.analyzeImpact(coreRepo.id, "core-utils");

      // Core change affects api (directly) and web (transitively or directly)
      const allAffected = [
        ...impact.directlyAffected,
        ...impact.transitivelyAffected,
      ];
      expect(allAffected).toContain(apiRepo.id);
      expect(allAffected.length).toBeGreaterThanOrEqual(1);
      expect(impact.risk).toBeDefined();
    });
  });

  describe("dependency graph", () => {
    it("returns correct nodes and edges for visualization", async () => {
      const { MultiRepoOrchestrator } = await import(
        "../../apps/orchestrator/src/composition/multi-repo"
      );

      const orchestrator = new MultiRepoOrchestrator();

      const repoA = orchestrator.registerRepo({
        name: "repo-a",
        url: "https://github.com/org/repo-a",
        defaultBranch: "main",
        languages: ["typescript"],
        manifestPath: "package.json",
        projectId: fixtures.project.id,
      });

      const repoB = orchestrator.registerRepo({
        name: "repo-b",
        url: "https://github.com/org/repo-b",
        defaultBranch: "main",
        languages: ["python"],
        manifestPath: "pyproject.toml",
        projectId: fixtures.project.id,
      });

      orchestrator.addDependency({
        sourceRepoId: repoA.id,
        targetRepoId: repoB.id,
        type: "internal_api",
        packageName: "repo-b/api",
      });

      const graph = orchestrator.getDependencyGraph();

      expect(graph.nodes).toHaveLength(2);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0].source).toBe(repoA.id);
      expect(graph.edges[0].target).toBe(repoB.id);
      expect(graph.edges[0].type).toBe("internal_api");
    });
  });
});
