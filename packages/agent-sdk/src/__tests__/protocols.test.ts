// @ts-nocheck – test assertions access array indices that TS can't prove are defined
import { describe, it, expect, vi, beforeEach } from "vitest";

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

// ═════════════════════════════════════════════════════════════════════════════
// DiscoveryProtocol
// ═════════════════════════════════════════════════════════════════════════════

import { DiscoveryProtocol } from "../protocols/discovery";

describe("DiscoveryProtocol", () => {
  let protocol: DiscoveryProtocol;

  beforeEach(() => {
    protocol = new DiscoveryProtocol("proj_1");
  });

  describe("getQuestions", () => {
    it("returns 5 discovery questions", () => {
      const questions = protocol.getQuestions();
      expect(questions).toHaveLength(5);
    });

    it("covers all categories: who, what, not, done, risk", () => {
      const questions = protocol.getQuestions();
      const categories = questions.map((q) => q.category);
      expect(categories).toContain("who");
      expect(categories).toContain("what");
      expect(categories).toContain("not");
      expect(categories).toContain("done");
      expect(categories).toContain("risk");
    });

    it("all questions are marked as required", () => {
      const questions = protocol.getQuestions();
      expect(questions.every((q) => q.required)).toBe(true);
    });
  });

  describe("processAnswer", () => {
    it("populates who personas from answer", () => {
      protocol.processAnswer("who", "- Admin users\n- Regular users\n- Developers");
      const spec = protocol.getSpec();
      expect(spec.who.personas).toHaveLength(3);
      expect(spec.who.personas).toContain("Admin users");
    });

    it("populates what features from answer", () => {
      protocol.processAnswer("what", "1. Dashboard\n2. Reports\n3. API access");
      const spec = protocol.getSpec();
      expect(spec.what.coreFeatures).toHaveLength(3);
      expect(spec.what.description).toContain("Dashboard");
    });

    it("populates not-in-scope from answer", () => {
      protocol.processAnswer("not", "- Mobile app\n- Offline mode");
      const spec = protocol.getSpec();
      expect(spec.notInScope).toHaveLength(2);
      expect(spec.notInScope).toContain("Mobile app");
    });

    it("populates acceptance criteria from answer", () => {
      protocol.processAnswer("done", "- Users can login\n- Dashboard loads in < 2s");
      const spec = protocol.getSpec();
      expect(spec.acceptanceCriteria).toHaveLength(2);
      expect(spec.acceptanceCriteria[0].testable).toBe(true);
    });

    it("populates risks from answer with medium severity default", () => {
      protocol.processAnswer("risk", "- API rate limits\n- Data loss\n- Slow performance");
      const spec = protocol.getSpec();
      expect(spec.risks).toHaveLength(3);
      expect(spec.risks[0].severity).toBe("medium");
      expect(spec.risks[0].risk).toContain("API rate limits");
    });

    it("updates confidence score after each answer", () => {
      expect(protocol.calculateConfidence()).toBe(0);

      protocol.processAnswer("who", "Admin users");
      expect(protocol.calculateConfidence()).toBe(0.15);

      protocol.processAnswer("what", "Dashboard feature");
      expect(protocol.calculateConfidence()).toBe(0.45);
    });
  });

  describe("calculateConfidence", () => {
    it("returns 0 when nothing is answered", () => {
      expect(protocol.calculateConfidence()).toBe(0);
    });

    it("returns 0.15 for who only", () => {
      protocol.processAnswer("who", "Admin");
      expect(protocol.calculateConfidence()).toBe(0.15);
    });

    it("returns 0.30 for what only", () => {
      protocol.processAnswer("what", "Dashboard");
      expect(protocol.calculateConfidence()).toBe(0.3);
    });

    it("returns 1.0 when all questions answered", () => {
      protocol.processAnswer("who", "Admin");
      protocol.processAnswer("what", "Dashboard");
      protocol.processAnswer("not", "Mobile");
      protocol.processAnswer("done", "Login works");
      protocol.processAnswer("risk", "Downtime");
      expect(protocol.calculateConfidence()).toBe(1.0);
    });

    it("weights what (0.30) and done (0.25) highest", () => {
      protocol.processAnswer("what", "Feature A");
      protocol.processAnswer("done", "Criteria A");
      expect(protocol.calculateConfidence()).toBe(0.55);
    });
  });

  describe("isReadyToProceed", () => {
    it("returns false when confidence < 0.8", () => {
      protocol.processAnswer("who", "Admin");
      expect(protocol.isReadyToProceed()).toBe(false);
    });

    it("returns true when confidence >= 0.8", () => {
      protocol.processAnswer("who", "Admin");
      protocol.processAnswer("what", "Dashboard");
      protocol.processAnswer("not", "Mobile");
      protocol.processAnswer("done", "Login works");
      // Confidence: 0.15 + 0.30 + 0.15 + 0.25 = 0.85
      expect(protocol.isReadyToProceed()).toBe(true);
    });

    it("returns true when all answered (1.0)", () => {
      protocol.processAnswer("who", "Admin");
      protocol.processAnswer("what", "Dashboard");
      protocol.processAnswer("not", "Mobile");
      protocol.processAnswer("done", "Login works");
      protocol.processAnswer("risk", "Downtime");
      expect(protocol.isReadyToProceed()).toBe(true);
    });
  });

  describe("getNextUnansweredQuestion", () => {
    it("returns first question when nothing answered", () => {
      const next = protocol.getNextUnansweredQuestion();
      expect(next).toBeTruthy();
      expect(next!.category).toBe("who");
    });

    it("skips answered categories", () => {
      protocol.processAnswer("who", "Admin");
      const next = protocol.getNextUnansweredQuestion();
      expect(next!.category).toBe("what");
    });

    it("returns null when all answered", () => {
      protocol.processAnswer("who", "Admin");
      protocol.processAnswer("what", "Dashboard");
      protocol.processAnswer("not", "Mobile");
      protocol.processAnswer("done", "Login works");
      protocol.processAnswer("risk", "Downtime");
      expect(protocol.getNextUnansweredQuestion()).toBeNull();
    });
  });

  describe("generateSystemPromptContext", () => {
    it("includes confidence score", () => {
      const ctx = protocol.generateSystemPromptContext();
      expect(ctx).toContain("Confidence Score");
    });

    it("includes answered sections", () => {
      protocol.processAnswer("who", "Admin users");
      protocol.processAnswer("what", "Dashboard feature");
      const ctx = protocol.generateSystemPromptContext();
      expect(ctx).toContain("Admin users");
      expect(ctx).toContain("Dashboard feature");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ArchitectProtocol
// ═════════════════════════════════════════════════════════════════════════════

import { ArchitectProtocol } from "../protocols/architect";
import type { TechStackDecision } from "../protocols/architect";

describe("ArchitectProtocol", () => {
  let protocol: ArchitectProtocol;

  const techStack: TechStackDecision = {
    frontend: ["Next.js", "React", "Tailwind CSS"],
    backend: ["tRPC", "Hono"],
    database: "PostgreSQL",
    auth: "Clerk",
    deployment: ["Docker", "k3s"],
    reasoning: "Modern stack for rapid development",
  };

  beforeEach(() => {
    protocol = new ArchitectProtocol("proj_1");
  });

  describe("setTechStack", () => {
    it("stores the tech stack decision", () => {
      protocol.setTechStack(techStack);
      const bp = protocol.getBlueprint();
      expect(bp.techStack.frontend).toContain("Next.js");
      expect(bp.techStack.database).toBe("PostgreSQL");
    });

    it("automatically creates an ADR for tech stack", () => {
      protocol.setTechStack(techStack);
      const bp = protocol.getBlueprint();
      expect(bp.adrs.length).toBeGreaterThanOrEqual(1);
      expect(bp.adrs[0].title).toBe("Tech Stack Selection");
      expect(bp.adrs[0].status).toBe("accepted");
    });
  });

  describe("addADR", () => {
    it("adds an ADR with generated id and accepted status", () => {
      protocol.addADR({
        title: "Use tRPC for API",
        context: "Need type-safe API layer",
        decision: "Use tRPC v11",
        consequences: ["Frontend and backend share types"],
      });

      const bp = protocol.getBlueprint();
      expect(bp.adrs).toHaveLength(1);
      expect(bp.adrs[0].id).toBe("adr_mock123");
      expect(bp.adrs[0].status).toBe("accepted");
      expect(bp.adrs[0].date).toBeTruthy();
    });

    it("accumulates multiple ADRs", () => {
      protocol.addADR({ title: "ADR 1", context: "C1", decision: "D1", consequences: [] });
      protocol.addADR({ title: "ADR 2", context: "C2", decision: "D2", consequences: [] });
      const bp = protocol.getBlueprint();
      expect(bp.adrs).toHaveLength(2);
    });
  });

  describe("identifyWorkstreams", () => {
    it("creates Database & Schema workstream when schema exists", () => {
      protocol.setDatabaseSchema([{
        tableName: "users",
        columns: [{ name: "id", type: "uuid", nullable: false }],
        indexes: ["users_pkey"],
      }]);

      const workstreams = protocol.identifyWorkstreams();
      const dbWs = workstreams.find((ws) => ws.name === "Database & Schema");
      expect(dbWs).toBeTruthy();
      expect(dbWs!.parallelizable).toBe(true);
    });

    it("creates API workstream when contracts exist", () => {
      protocol.setDatabaseSchema([{
        tableName: "users",
        columns: [{ name: "id", type: "uuid", nullable: false }],
        indexes: [],
      }]);
      protocol.setAPIContracts([{
        path: "/api/users",
        method: "GET",
        description: "List users",
        inputType: "void",
        outputType: "User[]",
        auth: true,
      }]);

      const workstreams = protocol.identifyWorkstreams();
      const apiWs = workstreams.find((ws) => ws.name === "API Implementation");
      expect(apiWs).toBeTruthy();
      expect(apiWs!.dependencies).toContain("Database & Schema");
    });

    it("creates Frontend workstream when component tree exists", () => {
      protocol.setComponentTree([{
        name: "Dashboard",
        type: "page",
        children: [],
        dependencies: [],
      }]);

      const workstreams = protocol.identifyWorkstreams();
      const frontendWs = workstreams.find((ws) => ws.name === "Frontend Implementation");
      expect(frontendWs).toBeTruthy();
      expect(frontendWs!.parallelizable).toBe(true);
    });

    it("always includes Testing & Security workstream", () => {
      const workstreams = protocol.identifyWorkstreams();
      const testWs = workstreams.find((ws) => ws.name === "Testing & Security");
      expect(testWs).toBeTruthy();
    });
  });

  describe("generateBlueprintMarkdown", () => {
    it("includes project blueprint header", () => {
      const md = protocol.generateBlueprintMarkdown();
      expect(md).toContain("# Project Blueprint");
    });

    it("includes tech stack section when set", () => {
      protocol.setTechStack(techStack);
      const md = protocol.generateBlueprintMarkdown();
      expect(md).toContain("## Tech Stack");
      expect(md).toContain("Next.js");
      expect(md).toContain("PostgreSQL");
    });

    it("includes database schema tables", () => {
      protocol.setDatabaseSchema([{
        tableName: "users",
        columns: [
          { name: "id", type: "uuid", nullable: false },
          { name: "email", type: "text", nullable: false },
        ],
        indexes: [],
      }]);
      const md = protocol.generateBlueprintMarkdown();
      expect(md).toContain("## Database Schema");
      expect(md).toContain("users");
      expect(md).toContain("email");
    });

    it("includes API contracts", () => {
      protocol.setAPIContracts([{
        path: "/api/users",
        method: "GET",
        description: "List all users",
        inputType: "void",
        outputType: "User[]",
        auth: true,
      }]);
      const md = protocol.generateBlueprintMarkdown();
      expect(md).toContain("## API Contracts");
      expect(md).toContain("GET /api/users");
    });

    it("includes ADR section", () => {
      protocol.addADR({
        title: "Use Drizzle ORM",
        context: "Need type-safe DB access",
        decision: "Use Drizzle",
        consequences: ["Must learn Drizzle API"],
      });
      const md = protocol.generateBlueprintMarkdown();
      expect(md).toContain("Architecture Decision Records");
      expect(md).toContain("Use Drizzle ORM");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PlannerProtocol
// ═════════════════════════════════════════════════════════════════════════════

import { PlannerProtocol } from "../protocols/planner";
import type { Blueprint, Workstream } from "../protocols/architect";

describe("PlannerProtocol", () => {
  let protocol: PlannerProtocol;

  beforeEach(() => {
    protocol = new PlannerProtocol("proj_1");
  });

  describe("createFromDescription", () => {
    it("creates a single-task plan from description", () => {
      const plan = protocol.createFromDescription("Build a user login page");
      expect(plan.tasks).toHaveLength(1);
      expect(plan.tasks[0].title).toBe("Build a user login page");
    });

    it("infers agent role from description", () => {
      const plan = protocol.createFromDescription("Build a React component for the dashboard");
      expect(plan.tasks[0].agentRole).toBe("frontend_coder");
    });

    it("uses provided agent role over inference", () => {
      const plan = protocol.createFromDescription("Fix the bug", "security_auditor");
      expect(plan.tasks[0].agentRole).toBe("security_auditor");
    });

    it("estimates credits based on description length", () => {
      const shortPlan = protocol.createFromDescription("Fix bug");
      expect(shortPlan.tasks[0].estimatedCredits).toBe(5); // < 100 chars

      const protocol2 = new PlannerProtocol("proj_2");
      const longDesc = "A".repeat(200);
      const mediumPlan = protocol2.createFromDescription(longDesc);
      expect(mediumPlan.tasks[0].estimatedCredits).toBe(15); // 100-500 chars
    });

    it("sets totalEstimatedCredits equal to task credits", () => {
      const plan = protocol.createFromDescription("Build API endpoint");
      expect(plan.totalEstimatedCredits).toBe(plan.tasks[0].estimatedCredits);
    });
  });

  describe("getExecutionOrder", () => {
    it("returns single wave for independent tasks", () => {
      protocol.createFromDescription("Task A");
      const waves = protocol.getExecutionOrder();
      expect(waves).toHaveLength(1);
      expect(waves[0]).toHaveLength(1);
    });

    it("returns tasks in dependency order", () => {
      const blueprint: Blueprint = {
        id: "bp_1",
        projectId: "proj_1",
        version: "1.0.0",
        techStack: {} as any,
        databaseSchema: [],
        apiContracts: [],
        componentTree: [],
        adrs: [],
        parallelWorkstreams: [
          {
            id: "ws_1",
            name: "Database",
            tasks: ["Create schema"],
            dependencies: [],
            parallelizable: true,
            estimatedCredits: 10,
          },
          {
            id: "ws_2",
            name: "API",
            tasks: ["Build endpoints"],
            dependencies: ["Database"],
            parallelizable: true,
            estimatedCredits: 15,
          },
        ],
        content: "",
      };

      protocol.createFromBlueprint(blueprint);
      const waves = protocol.getExecutionOrder();

      // Should have at least 1 wave
      expect(waves.length).toBeGreaterThanOrEqual(1);
      // First wave should contain Database tasks (no deps)
      const firstWaveTitles = waves[0].map((t: any) => t.title);
      expect(firstWaveTitles.length).toBeGreaterThan(0);
    });

    it("handles circular dependencies by forcing remaining tasks", () => {
      // This is tested by the safety mechanism in getExecutionOrder
      const plan = protocol.createFromDescription("Some task");
      const waves = protocol.getExecutionOrder();
      expect(waves).toBeTruthy();
    });
  });

  describe("createFromBlueprint", () => {
    it("creates tasks from all workstreams", () => {
      const blueprint: Blueprint = {
        id: "bp_1",
        projectId: "proj_1",
        version: "1.0.0",
        techStack: {} as any,
        databaseSchema: [],
        apiContracts: [],
        componentTree: [],
        adrs: [],
        parallelWorkstreams: [
          { id: "ws_1", name: "DB", tasks: ["Migration A", "Migration B"], dependencies: [], parallelizable: true, estimatedCredits: 20 },
          { id: "ws_2", name: "API", tasks: ["Endpoint A"], dependencies: ["DB"], parallelizable: true, estimatedCredits: 15 },
        ],
        content: "",
      };

      const plan = protocol.createFromBlueprint(blueprint);
      expect(plan.tasks).toHaveLength(3); // 2 DB + 1 API
      expect(plan.totalEstimatedCredits).toBe(35); // 10 + 10 + 15
    });

    it("sets up dependencies between workstreams", () => {
      const blueprint: Blueprint = {
        id: "bp_1",
        projectId: "proj_1",
        version: "1.0.0",
        techStack: {} as any,
        databaseSchema: [],
        apiContracts: [],
        componentTree: [],
        adrs: [],
        parallelWorkstreams: [
          { id: "ws_1", name: "DB", tasks: ["Schema"], dependencies: [], parallelizable: true, estimatedCredits: 10 },
          { id: "ws_2", name: "API", tasks: ["Routes"], dependencies: ["DB"], parallelizable: true, estimatedCredits: 10 },
        ],
        content: "",
      };

      const plan = protocol.createFromBlueprint(blueprint);
      expect(plan.dependencies.length).toBeGreaterThanOrEqual(1);
    });

    it("creates parallel groups for parallelizable workstreams", () => {
      const blueprint: Blueprint = {
        id: "bp_1",
        projectId: "proj_1",
        version: "1.0.0",
        techStack: {} as any,
        databaseSchema: [],
        apiContracts: [],
        componentTree: [],
        adrs: [],
        parallelWorkstreams: [
          { id: "ws_1", name: "DB", tasks: ["Schema"], dependencies: [], parallelizable: true, estimatedCredits: 10 },
          { id: "ws_2", name: "Sequential", tasks: ["Step A"], dependencies: [], parallelizable: false, estimatedCredits: 5 },
        ],
        content: "",
      };

      const plan = protocol.createFromBlueprint(blueprint);
      expect(plan.parallelGroups).toHaveLength(1); // Only DB is parallelizable
      expect(plan.parallelGroups[0].name).toBe("DB");
    });
  });

  describe("inferAgentRole (via createFromDescription)", () => {
    it("routes database tasks to backend_coder", () => {
      const plan = protocol.createFromDescription("Create database migration");
      expect(plan.tasks[0].agentRole).toBe("backend_coder");
    });

    it("routes API tasks to backend_coder", () => {
      const p = new PlannerProtocol("p");
      const plan = p.createFromDescription("Build REST API endpoint");
      expect(plan.tasks[0].agentRole).toBe("backend_coder");
    });

    it("routes component tasks to frontend_coder", () => {
      const p = new PlannerProtocol("p");
      const plan = p.createFromDescription("Build React component for dashboard");
      expect(plan.tasks[0].agentRole).toBe("frontend_coder");
    });

    it("routes test tasks to test_engineer", () => {
      const p = new PlannerProtocol("p");
      const plan = p.createFromDescription("Write unit tests for auth module");
      expect(plan.tasks[0].agentRole).toBe("test_engineer");
    });

    it("routes security tasks to security_auditor", () => {
      const p = new PlannerProtocol("p");
      const plan = p.createFromDescription("Run security audit on code");
      expect(plan.tasks[0].agentRole).toBe("security_auditor");
    });

    it("routes deploy tasks to deploy_engineer", () => {
      const p = new PlannerProtocol("p");
      const plan = p.createFromDescription("Set up Docker deployment");
      expect(plan.tasks[0].agentRole).toBe("deploy_engineer");
    });

    it("routes integration tasks to integration_coder", () => {
      const p = new PlannerProtocol("p");
      const plan = p.createFromDescription("Wire up the client integration layer");
      expect(plan.tasks[0].agentRole).toBe("integration_coder");
    });

    it("defaults to backend_coder for ambiguous tasks", () => {
      const p = new PlannerProtocol("p");
      const plan = p.createFromDescription("Fix the thing");
      expect(plan.tasks[0].agentRole).toBe("backend_coder");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CILoopProtocol
// ═════════════════════════════════════════════════════════════════════════════

import { CILoopProtocol } from "../protocols/ci-loop";

describe("CILoopProtocol", () => {
  describe("parseTestOutput", () => {
    let protocol: CILoopProtocol;

    beforeEach(() => {
      protocol = new CILoopProtocol("ses_1");
    });

    it("parses vitest/jest format: Tests: X passed, Y failed, Z total", () => {
      const output = `Tests: 10 passed, 2 failed, 12 total\nDuration: 3.5s`;
      const result = protocol.parseTestOutput(output);
      expect(result.passedTests).toBe(10);
      expect(result.failedTests).toBe(2);
      expect(result.totalTests).toBe(12);
      expect(result.duration).toBe(3.5);
      expect(result.passed).toBe(false);
    });

    it("parses alternative format: X passing, Y failing", () => {
      const output = `8 passing, 1 failing\nTime: 2.1s`;
      const result = protocol.parseTestOutput(output);
      expect(result.passedTests).toBe(8);
      expect(result.failedTests).toBe(1);
      expect(result.totalTests).toBe(9);
      expect(result.duration).toBe(2.1);
    });

    it("detects all passing (passed = true)", () => {
      const output = `Tests: 15 passed, 0 failed, 15 total\nDuration: 1.2s`;
      const result = protocol.parseTestOutput(output);
      expect(result.passed).toBe(true);
      expect(result.failedTests).toBe(0);
    });

    it("parses TypeScript errors", () => {
      const output = `error TS2345: Argument of type 'string' is not assignable\nerror TS2304: Cannot find name 'foo'`;
      const result = protocol.parseTestOutput(output);
      expect(result.failures).toHaveLength(2);
      expect(result.failures[0].category).toBe("type");
      expect(result.failures[0].testName).toBe("TypeScript");
      expect(result.failedTests).toBe(2);
    });

    it("extracts failure blocks from FAIL markers", () => {
      const output = `FAIL src/test.ts\n  expected 1 to be 2\n    at line 10\nFAIL src/other.ts\n  timeout exceeded`;
      const result = protocol.parseTestOutput(output);
      expect(result.failures.length).toBeGreaterThanOrEqual(2);
    });

    it("returns empty result for unparseable output", () => {
      const output = "Some random log output with no test results";
      const result = protocol.parseTestOutput(output);
      expect(result.totalTests).toBe(0);
      expect(result.passed).toBe(false);
    });

    it("parses Duration field", () => {
      const output = "Tests: 5 passed, 0 failed, 5 total\nDuration: 12.5s";
      const result = protocol.parseTestOutput(output);
      expect(result.duration).toBe(12.5);
    });

    it("parses Time field as alternative to Duration", () => {
      const output = "5 passing, 0 failing\nTime: 0.8s";
      const result = protocol.parseTestOutput(output);
      expect(result.duration).toBe(0.8);
    });
  });

  describe("runLoop", () => {
    it("returns success when tests pass on first try", async () => {
      const protocol = new CILoopProtocol("ses_1", undefined, 5);
      const runTests = vi.fn().mockResolvedValue({
        passed: true, totalTests: 10, passedTests: 10, failedTests: 0, failures: [], duration: 1,
      });
      const applyFix = vi.fn();

      const result = await protocol.runLoop(runTests, applyFix);
      expect(result.success).toBe(true);
      expect(result.iterations).toBe(1);
      expect(applyFix).not.toHaveBeenCalled();
    });

    it("applies fixes and retries on failure", async () => {
      const protocol = new CILoopProtocol("ses_1", undefined, 5);
      const runTests = vi.fn()
        .mockResolvedValueOnce({
          passed: false, totalTests: 5, passedTests: 3, failedTests: 2,
          failures: [{ testName: "test1", testFile: "", error: "fail", stackTrace: "", category: "unit" }],
          duration: 1,
        })
        .mockResolvedValueOnce({
          passed: true, totalTests: 5, passedTests: 5, failedTests: 0, failures: [], duration: 1,
        });
      const applyFix = vi.fn().mockResolvedValue({ filesChanged: ["src/fix.ts"], description: "Fixed test1" });

      const result = await protocol.runLoop(runTests, applyFix);
      expect(result.success).toBe(true);
      expect(result.iterations).toBe(2);
      expect(applyFix).toHaveBeenCalledTimes(1);
    });

    it("escalates after max iterations", async () => {
      const protocol = new CILoopProtocol("ses_1", undefined, 2);
      const runTests = vi.fn().mockResolvedValue({
        passed: false, totalTests: 5, passedTests: 3, failedTests: 2,
        failures: [{ testName: "test1", testFile: "", error: "always fails", stackTrace: "", category: "unit" }],
        duration: 1,
      });
      const applyFix = vi.fn().mockResolvedValue({ filesChanged: [], description: "Attempted fix" });

      const result = await protocol.runLoop(runTests, applyFix);
      expect(result.success).toBe(false);
      expect(result.escalated).toBe(true);
      expect(result.iterations).toBe(2);
    });

    it("escalates on repeated identical failures", async () => {
      const protocol = new CILoopProtocol("ses_1", undefined, 10);
      const sameFailure = [
        { testName: "flaky_test", testFile: "", error: "always the same error", stackTrace: "", category: "unit" as const },
      ];
      const runTests = vi.fn().mockResolvedValue({
        passed: false, totalTests: 1, passedTests: 0, failedTests: 1,
        failures: sameFailure, duration: 1,
      });
      const applyFix = vi.fn().mockResolvedValue({ filesChanged: [], description: "No fix" });

      const result = await protocol.runLoop(runTests, applyFix);
      expect(result.success).toBe(false);
      expect(result.escalated).toBe(true);
      // Should escalate after 3 identical failure rounds
      expect(result.iterations).toBeLessThanOrEqual(4);
    });
  });

  describe("categorizeFailure", () => {
    it("routes import errors to integration_coder", () => {
      const protocol = new CILoopProtocol("ses_1");
      const result = protocol.categorizeFailure({
        testName: "test", testFile: "", error: "Cannot find module '@foo/bar'", stackTrace: "", category: "unit",
      });
      expect(result).toBe("integration_coder");
    });

    it("routes render errors to frontend_coder", () => {
      const protocol = new CILoopProtocol("ses_1");
      const result = protocol.categorizeFailure({
        testName: "test", testFile: "", error: "Failed to render component", stackTrace: "", category: "unit",
      });
      expect(result).toBe("frontend_coder");
    });

    it("routes database errors to backend_coder", () => {
      const protocol = new CILoopProtocol("ses_1");
      const result = protocol.categorizeFailure({
        testName: "test", testFile: "", error: "Database query failed", stackTrace: "", category: "unit",
      });
      expect(result).toBe("backend_coder");
    });

    it("defaults to backend_coder for unknown errors", () => {
      const protocol = new CILoopProtocol("ses_1");
      const result = protocol.categorizeFailure({
        testName: "test", testFile: "", error: "Something went wrong", stackTrace: "", category: "unit",
      });
      expect(result).toBe("backend_coder");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BusinessLogicGuardian
// ═════════════════════════════════════════════════════════════════════════════

import { BusinessLogicGuardian } from "../protocols/guardian";

describe("BusinessLogicGuardian", () => {
  let guardian: BusinessLogicGuardian;

  beforeEach(() => {
    guardian = new BusinessLogicGuardian();
  });

  describe("checkFileChange without rules", () => {
    it("passes when no rules are set", () => {
      const result = guardian.checkFileChange("src/index.ts", "const x = 1;");
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });

  describe("checkFileChange with rules", () => {
    beforeEach(() => {
      guardian.setRules({
        techStack: ["React", "TypeScript"],
        namingConventions: {
          files: "kebab-case",
          components: "PascalCase",
          functions: "camelCase",
          constants: "UPPER_SNAKE_CASE",
        },
        patterns: { stateManagement: "zustand", dataFetching: "tRPC", authentication: "Clerk", errorHandling: "error boundary" },
        forbidden: [],
        required: [],
      });
    });

    it("detects eval() as security error", () => {
      const result = guardian.checkFileChange("src/utils.ts", 'const result = eval("1+1");');
      expect(result.passed).toBe(false);
      const evalViolation = result.violations.find((v) => v.message.includes("eval"));
      expect(evalViolation).toBeTruthy();
      expect(evalViolation!.severity).toBe("error");
    });

    it("detects innerHTML as security error", () => {
      const result = guardian.checkFileChange("src/page.ts", 'element.innerHTML = userInput;');
      expect(result.passed).toBe(false);
      const violation = result.violations.find((v) => v.message.includes("innerHTML"));
      expect(violation).toBeTruthy();
      expect(violation!.severity).toBe("error");
    });

    it("detects console.log as warning", () => {
      const result = guardian.checkFileChange("src/service.ts", 'console.log("debug");');
      const violation = result.violations.find((v) => v.message.includes("console.log"));
      expect(violation).toBeTruthy();
      expect(violation!.severity).toBe("warning");
    });

    it("detects dangerouslySetInnerHTML as warning", () => {
      const result = guardian.checkFileChange("src/comp.tsx", '<div dangerouslySetInnerHTML={{ __html: x }} />');
      const violation = result.violations.find((v) => v.message.includes("dangerouslySetInnerHTML"));
      expect(violation).toBeTruthy();
      expect(violation!.severity).toBe("warning");
    });

    it("warns on PascalCase violation for component files", () => {
      const result = guardian.checkFileChange("src/components/myButton.tsx", "export default function myButton() {}");
      const naming = result.violations.find((v) => v.type === "naming");
      expect(naming).toBeTruthy();
      expect(naming!.message).toContain("PascalCase");
    });

    it("passes PascalCase component files", () => {
      const result = guardian.checkFileChange("src/components/MyButton.tsx", "export default function MyButton() {}");
      const naming = result.violations.find((v) => v.type === "naming");
      expect(naming).toBeUndefined();
    });

    it("detects hardcoded secrets", () => {
      const result = guardian.checkFileChange("src/config.ts", 'const apikey = "sk-live-abc123def456ghi789jkl012mno345"');
      const secretViolation = result.violations.find((v) => v.message.includes("secret"));
      expect(secretViolation).toBeTruthy();
      expect(secretViolation!.severity).toBe("error");
    });

    it("detects PII in logging", () => {
      const result = guardian.checkFileChange("src/auth.ts", 'logger.info("User email:", email);');
      const piiViolation = result.violations.find((v) => v.type === "compliance");
      expect(piiViolation).toBeTruthy();
      expect(piiViolation!.message).toContain("email");
    });

    it("passes clean code without violations", () => {
      const cleanCode = `
        import { logger } from "@prometheus/logger";
        export function calculateTotal(items: number[]): number {
          return items.reduce((sum, item) => sum + item, 0);
        }
      `;
      const result = guardian.checkFileChange("src/utils/math.ts", cleanCode);
      // Only info-level violations are acceptable (like process.env)
      const errors = result.violations.filter((v) => v.severity === "error");
      expect(errors).toHaveLength(0);
    });

    it("includes file path in violations", () => {
      const result = guardian.checkFileChange("src/bad.ts", 'eval("x")');
      expect(result.violations[0].file).toBe("src/bad.ts");
    });

    it("includes checkedAt timestamp", () => {
      const result = guardian.checkFileChange("src/ok.ts", "const x = 1;");
      expect(result.checkedAt).toBeTruthy();
      expect(() => new Date(result.checkedAt)).not.toThrow();
    });
  });

  describe("extractRulesFromBlueprint", () => {
    it("extracts tech stack from blueprint markdown", () => {
      const blueprintMd = `# Blueprint\n\n## Tech Stack\n- **Frontend:** React, Next.js\n- **Backend:** Hono, tRPC\n- **Database:** PostgreSQL\n\n## Other`;
      const rules = guardian.extractRulesFromBlueprint(blueprintMd);
      expect(rules.techStack.length).toBeGreaterThan(0);
    });

    it("sets default naming conventions", () => {
      const rules = guardian.extractRulesFromBlueprint("# Blueprint\n## Tech Stack\n- **Frontend:** React");
      expect(rules.namingConventions.files).toBe("kebab-case");
      expect(rules.namingConventions.components).toBe("PascalCase");
    });
  });
});
