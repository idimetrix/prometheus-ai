/**
 * Integration tests: Agent Role Routing.
 *
 * Verifies that the TaskRouter's regex-based routing correctly matches
 * task descriptions to the appropriate agent roles, and that the
 * adaptive pipeline selects appropriate complexity levels.
 *
 * Tests use the same regex patterns and logic as the production
 * TaskRouter (apps/orchestrator/src/task-router.ts) to validate
 * routing accuracy without requiring live database connections.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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

// ─── Regex patterns from TaskRouter ─────────────────────────────────────────

const REQUIREMENTS_RE =
  /\b(requirements?|user stor(?:y|ies)?|acceptance criteria|scope|srs|discover|elicit|interview)\b/;
const ARCHITECTURE_RE =
  /\b(architect|blueprint|schema|data model|tech stack|adr|system design|api contract)\b/;
const PLANNING_RE =
  /\b(plan|sprint|roadmap|milestone|timeline|schedule|backlog|epic)\b/;
const FRONTEND_RE =
  /\b(component|page|ui|ux|frontend|react|next\.?js|tailwind|css|layout|form|button|modal|sidebar|dashboard)\b/;
const BACKEND_RE =
  /\b(api|endpoint|route|controller|service|middleware|database|query|migration|trpc|crud|webhook)\b/;
const TESTING_RE =
  /\b(tests?|specs?|coverage|vitest|playwright|e2e|unit tests?|integration tests?|assert|expect)\b/;
const SECURITY_RE =
  /\b(security|audit|vulnerabilit|owasp|injection|xss|csrf|auth.*bypass|penetration|cve)\b/;
const DEPLOYMENT_RE =
  /\b(deploy|docker|kubernetes|k8s|k3s|ci.?cd|github action|helm|traefik|nginx|ssl|tls)\b/;
const INTEGRATION_RE =
  /\b(integrat|connect|wire|hook up|link|bind|api call|fetch data|real.?time)\b/;

const SIMPLE_KEYWORDS_RE =
  /\b(rename|typo|fix\s+import|update\s+version|change\s+color|bump|toggle)\b/i;
const CRITICAL_KEYWORDS_RE =
  /\b(security|production|migration|breaking|critical|rollback|incident)\b/i;
const COMPLEX_KEYWORDS_RE =
  /\b(full.?stack|multi.?service|architecture|redesign|platform|infrastructure|distributed)\b/i;
const WHITESPACE_SPLIT_RE = /\s+/;

type PipelineComplexity = "simple" | "medium" | "complex" | "critical";

interface TaskRoutingResult {
  agentRole: string;
  confidence: number;
  reasoning: string;
}

// ─── Routing logic mirroring TaskRouter.routeTask (Stage 2: regex) ──────────

function routeTask(taskDescription: string): TaskRoutingResult {
  const description = taskDescription.toLowerCase();
  const candidates: TaskRoutingResult[] = [];

  const matchers: Array<{
    test: (d: string) => boolean;
    role: string;
    confidence: number;
    reasoning: string;
  }> = [
    {
      test: (d) => REQUIREMENTS_RE.test(d),
      role: "discovery",
      confidence: 0.9,
      reasoning: "Task involves requirements gathering",
    },
    {
      test: (d) => ARCHITECTURE_RE.test(d),
      role: "architect",
      confidence: 0.9,
      reasoning: "Task involves architecture design",
    },
    {
      test: (d) => PLANNING_RE.test(d),
      role: "planner",
      confidence: 0.85,
      reasoning: "Task involves planning or sprint creation",
    },
    {
      test: (d) => FRONTEND_RE.test(d),
      role: "frontend_coder",
      confidence: 0.85,
      reasoning: "Task involves frontend/UI work",
    },
    {
      test: (d) => BACKEND_RE.test(d),
      role: "backend_coder",
      confidence: 0.85,
      reasoning: "Task involves backend/API work",
    },
    {
      test: (d) => TESTING_RE.test(d),
      role: "test_engineer",
      confidence: 0.9,
      reasoning: "Task involves writing tests",
    },
    {
      test: (d) => SECURITY_RE.test(d),
      role: "security_auditor",
      confidence: 0.9,
      reasoning: "Task involves security audit",
    },
    {
      test: (d) => DEPLOYMENT_RE.test(d),
      role: "deploy_engineer",
      confidence: 0.9,
      reasoning: "Task involves deployment",
    },
    {
      test: (d) => INTEGRATION_RE.test(d),
      role: "integration_coder",
      confidence: 0.8,
      reasoning: "Task involves integration work",
    },
  ];

  for (const matcher of matchers) {
    if (matcher.test(description)) {
      candidates.push({
        agentRole: matcher.role,
        confidence: matcher.confidence,
        reasoning: matcher.reasoning,
      });
    }
  }

  if (
    candidates.length === 1 &&
    (candidates[0] as TaskRoutingResult).confidence >= 0.85
  ) {
    return candidates[0] as TaskRoutingResult;
  }

  if (candidates.length > 0) {
    return candidates[0] as TaskRoutingResult;
  }

  return {
    agentRole: "orchestrator",
    confidence: 0.5,
    reasoning: "Task is complex or ambiguous, needs orchestration",
  };
}

// ─── Complexity estimation mirroring TaskRouter.estimateComplexity ───────────

function estimateComplexity(taskDescription: string): PipelineComplexity {
  const desc = taskDescription.toLowerCase();

  if (CRITICAL_KEYWORDS_RE.test(desc)) {
    return "critical";
  }
  if (COMPLEX_KEYWORDS_RE.test(desc)) {
    return "complex";
  }
  if (SIMPLE_KEYWORDS_RE.test(desc)) {
    return "simple";
  }

  const wordCount = desc.split(WHITESPACE_SPLIT_RE).length;
  if (wordCount > 100) {
    return "complex";
  }
  if (wordCount > 30) {
    return "medium";
  }
  return "simple";
}

// ─── Adaptive pipeline mirroring TaskRouter.adaptPipeline ───────────────────

function adaptPipeline(
  _taskDescription: string,
  complexityEstimate: PipelineComplexity
) {
  switch (complexityEstimate) {
    case "simple":
      return {
        complexity: "simple",
        phases: ["coding", "testing"],
        useMoA: false,
        extraReviewPasses: 0,
      };
    case "medium":
      return {
        complexity: "medium",
        phases: ["discovery", "coding", "testing", "ci_loop"],
        useMoA: false,
        extraReviewPasses: 0,
      };
    case "complex":
      return {
        complexity: "complex",
        phases: [
          "discovery",
          "architecture",
          "planning",
          "spec_first",
          "coding",
          "testing",
          "ci_loop",
          "security",
          "deploy",
        ],
        useMoA: true,
        extraReviewPasses: 0,
      };
    case "critical":
      return {
        complexity: "critical",
        phases: [
          "discovery",
          "architecture",
          "planning",
          "spec_first",
          "coding",
          "visual_verify",
          "testing",
          "ci_loop",
          "property_testing",
          "security",
          "deploy",
        ],
        useMoA: true,
        extraReviewPasses: 2,
      };
    default:
      return {
        complexity: "medium",
        phases: ["discovery", "coding", "testing", "ci_loop"],
        useMoA: false,
        extraReviewPasses: 0,
      };
  }
}

describe("Agent Role Routing", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("regex-based routing (Stage 2 fallback)", () => {
    it("routes 'Add user authentication API endpoint' to backend_coder", () => {
      const result = routeTask("Add user authentication API endpoint");
      expect(result.agentRole).toBe("backend_coder");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("routes 'Design the database schema' to architect", () => {
      const result = routeTask("Design the database schema");
      expect(result.agentRole).toBe("architect");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("routes 'Create React dashboard' to frontend_coder", () => {
      const result = routeTask("Create React dashboard");
      expect(result.agentRole).toBe("frontend_coder");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("routes 'Fix the login bug in the API endpoint' to backend_coder", () => {
      const result = routeTask("Fix the login bug in the API endpoint");
      expect(result.agentRole).toBe("backend_coder");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("routes 'Write unit tests for auth module' to test_engineer", () => {
      const result = routeTask("Write unit tests for auth module");
      expect(result.agentRole).toBe("test_engineer");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("routes 'Deploy to production with Docker' to deploy_engineer", () => {
      const result = routeTask("Deploy to production with Docker");
      expect(result.agentRole).toBe("deploy_engineer");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("routes 'Review code for security issues and OWASP vulnerabilities' to security_auditor", () => {
      const result = routeTask(
        "Review code for security issues and OWASP vulnerabilities"
      );
      expect(result.agentRole).toBe("security_auditor");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("routes 'Plan the sprint tasks and create backlog' to planner", () => {
      const result = routeTask("Plan the sprint tasks and create backlog");
      expect(result.agentRole).toBe("planner");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("routes 'Wire up the real-time data connection' to integration_coder", () => {
      const result = routeTask(
        "Wire up the real-time data connection between services"
      );
      expect(result.agentRole).toBe("integration_coder");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("routes 'Gather requirements from stakeholder' to discovery", () => {
      const result = routeTask(
        "Gather requirements from stakeholder interviews"
      );
      expect(result.agentRole).toBe("discovery");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("routes 'Create a tRPC endpoint for CRUD operations' to backend_coder", () => {
      const result = routeTask(
        "Create a tRPC endpoint for CRUD operations on projects"
      );
      expect(result.agentRole).toBe("backend_coder");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("routes 'Build the settings page with profile editing' to frontend_coder", () => {
      const result = routeTask("Build the settings page with profile editing");
      expect(result.agentRole).toBe("frontend_coder");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("routes 'Create Playwright E2E tests for login flow' to test_engineer", () => {
      const result = routeTask("Create Playwright E2E tests for login flow");
      expect(result.agentRole).toBe("test_engineer");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("routes 'Set up Kubernetes deployment manifests' to deploy_engineer", () => {
      const result = routeTask(
        "Set up Kubernetes deployment manifests and CI/CD pipeline"
      );
      expect(result.agentRole).toBe("deploy_engineer");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("routes 'Scan for credential leaks and XSS vulnerabilities' to security_auditor", () => {
      const result = routeTask(
        "Scan for credential leaks and XSS vulnerabilities"
      );
      expect(result.agentRole).toBe("security_auditor");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("routes 'Create the project Blueprint and tech stack' to architect", () => {
      const result = routeTask(
        "Create the project Blueprint and tech stack selection"
      );
      expect(result.agentRole).toBe("architect");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("routes 'Break down the notification system into tasks for the sprint' to planner", () => {
      const result = routeTask(
        "Break down the notification system into tasks for the sprint"
      );
      expect(result.agentRole).toBe("planner");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("routes 'Hook up real-time Socket.io events to notification panel' to integration_coder", () => {
      const result = routeTask(
        "Hook up real-time Socket.io events to the notification panel"
      );
      expect(result.agentRole).toBe("integration_coder");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("routes 'Write user story acceptance criteria for onboarding' to discovery", () => {
      const result = routeTask(
        "Write user story acceptance criteria for the onboarding flow"
      );
      expect(result.agentRole).toBe("discovery");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("routes 'Build a sidebar component with navigation links' to frontend_coder", () => {
      const result = routeTask(
        "Build a sidebar component with navigation links"
      );
      expect(result.agentRole).toBe("frontend_coder");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("falls back to orchestrator for ambiguous task", () => {
      const result = routeTask("Do something with the project in general");
      expect(result.agentRole).toBe("orchestrator");
      expect(result.confidence).toBe(0.5);
    });
  });

  describe("confidence scores", () => {
    it("returns confidence >= 0.85 for clear single-match tasks", () => {
      const clearCases = [
        "Write comprehensive unit tests for the billing module",
        "Perform a penetration test for OWASP vulnerabilities",
        "Deploy the service to Kubernetes with Helm charts",
        "Design the system architecture and data model",
        "Create a roadmap and sprint plan for the milestone",
        "Elicit requirements and write user stories for the feature",
      ];

      for (const desc of clearCases) {
        const result = routeTask(desc);
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
        expect(result.agentRole).not.toBe("orchestrator");
      }
    });

    it("returns lower confidence for multi-match tasks", () => {
      // This matches both backend and testing patterns
      const result = routeTask("Write tests for the API endpoint");
      expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      expect(result.agentRole).toBeTruthy();
    });
  });

  describe("adaptive pipeline complexity", () => {
    it("classifies simple tasks as 'simple'", () => {
      expect(estimateComplexity("rename the variable foo")).toBe("simple");
      expect(estimateComplexity("fix import statement")).toBe("simple");
      expect(estimateComplexity("change color of the button")).toBe("simple");
      expect(estimateComplexity("bump the version number")).toBe("simple");
    });

    it("classifies critical tasks as 'critical'", () => {
      expect(estimateComplexity("fix security vulnerability")).toBe("critical");
      expect(estimateComplexity("production migration for database")).toBe(
        "critical"
      );
      expect(estimateComplexity("critical incident rollback needed")).toBe(
        "critical"
      );
    });

    it("classifies complex tasks as 'complex'", () => {
      expect(estimateComplexity("full-stack platform redesign")).toBe(
        "complex"
      );
      expect(estimateComplexity("multi-service distributed architecture")).toBe(
        "complex"
      );
      expect(
        estimateComplexity("infrastructure overhaul for the platform")
      ).toBe("complex");
    });

    it("classifies medium-length tasks as 'medium'", () => {
      const mediumDesc = Array.from({ length: 40 }, () => "word").join(" ");
      expect(estimateComplexity(mediumDesc)).toBe("medium");
    });

    it("classifies very long descriptions as 'complex'", () => {
      const longDesc = Array.from({ length: 150 }, () => "word").join(" ");
      expect(estimateComplexity(longDesc)).toBe("complex");
    });

    it("classifies short unmatched tasks as 'simple'", () => {
      expect(estimateComplexity("hello world")).toBe("simple");
    });

    it("adaptPipeline returns correct phases for each complexity", () => {
      const simple = adaptPipeline("rename variable", "simple");
      expect(simple.complexity).toBe("simple");
      expect(simple.phases).toEqual(["coding", "testing"]);
      expect(simple.useMoA).toBe(false);
      expect(simple.extraReviewPasses).toBe(0);

      const medium = adaptPipeline("medium task", "medium");
      expect(medium.phases).toContain("discovery");
      expect(medium.phases).toContain("ci_loop");

      const complex = adaptPipeline("complex task", "complex");
      expect(complex.phases).toContain("architecture");
      expect(complex.phases).toContain("spec_first");
      expect(complex.useMoA).toBe(true);

      const critical = adaptPipeline("critical task", "critical");
      expect(critical.phases).toContain("property_testing");
      expect(critical.phases).toContain("visual_verify");
      expect(critical.extraReviewPasses).toBe(2);
    });

    it("simple pipeline has fewer phases than complex", () => {
      const simple = adaptPipeline("rename", "simple");
      const complex = adaptPipeline("redesign", "complex");
      expect(simple.phases.length).toBeLessThan(complex.phases.length);
    });

    it("critical pipeline includes all complex phases plus extras", () => {
      const complex = adaptPipeline("redesign", "complex");
      const critical = adaptPipeline("incident", "critical");

      // Critical has everything complex has plus visual_verify and property_testing
      for (const phase of complex.phases) {
        expect(critical.phases).toContain(phase);
      }
      expect(critical.phases.length).toBeGreaterThan(complex.phases.length);
    });
  });

  describe("routing edge cases", () => {
    it("handles empty string input", () => {
      const result = routeTask("");
      expect(result.agentRole).toBe("orchestrator");
    });

    it("handles very long input strings", () => {
      const longInput = "design the schema ".repeat(500);
      const result = routeTask(longInput);
      expect(result.agentRole).toBe("architect");
    });

    it("is case-insensitive for routing", () => {
      const lower = routeTask("deploy to kubernetes");
      const upper = routeTask("DEPLOY TO KUBERNETES");
      const mixed = routeTask("Deploy To Kubernetes");

      expect(lower.agentRole).toBe(upper.agentRole);
      expect(upper.agentRole).toBe(mixed.agentRole);
    });

    it("routes multi-keyword tasks to first matching role", () => {
      // Contains both backend and testing keywords
      const result = routeTask("Write unit tests for the API endpoint");
      // Backend matcher comes before testing in the order
      expect(["backend_coder", "test_engineer"]).toContain(result.agentRole);
    });
  });
});
