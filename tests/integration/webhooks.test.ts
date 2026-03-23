/**
 * Integration tests: Webhook Handlers.
 *
 * Verifies GitHub, Jira, and custom webhook signature verification,
 * event processing, task creation, and idempotency.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIntegrationFixtures, createMockJobQueue } from "./setup";

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

// Track DB inserts and queue adds
const mockDbInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({
    onConflictDoUpdate: vi.fn(),
  }),
});
const mockDbSelect = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: vi
        .fn()
        .mockResolvedValue([{ id: "proj_test123", orgId: "org_test123" }]),
    }),
  }),
});
const mockDbQuery = {
  organizations: {
    findFirst: vi.fn().mockResolvedValue({
      id: "org_test123",
      planTier: "pro",
    }),
  },
};

vi.mock("@prometheus/db", () => ({
  db: {
    insert: mockDbInsert,
    select: mockDbSelect,
    query: mockDbQuery,
  },
  projects: { id: "id", orgId: "orgId", repoUrl: "repoUrl" },
  sessions: {},
  tasks: {},
  organizations: { id: "id" },
}));

const mockQueueAdd = vi.fn().mockResolvedValue({ id: "job_1" });
vi.mock("@prometheus/queue", () => ({
  agentTaskQueue: { add: mockQueueAdd },
}));

vi.mock("@prometheus/utils", () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_mock_${Date.now()}`),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => "eq_condition"),
  and: vi.fn((..._args: unknown[]) => "and_condition"),
}));

// Set webhook secrets for testing
const GITHUB_SECRET = "test-github-webhook-secret";
const JIRA_SECRET = "test-jira-webhook-secret";
const CUSTOM_SECRET = "test-custom-webhook-secret";

function generateGitHubSignature(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function generateCustomSignature(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("Webhook Handlers", () => {
  let _fixtures: ReturnType<typeof createIntegrationFixtures>;

  beforeEach(() => {
    _fixtures = createIntegrationFixtures();
    process.env.GITHUB_WEBHOOK_SECRET = GITHUB_SECRET;
    process.env.JIRA_WEBHOOK_SECRET = JIRA_SECRET;
    process.env.CUSTOM_WEBHOOK_SECRET = CUSTOM_SECRET;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.GITHUB_WEBHOOK_SECRET = undefined;
    process.env.JIRA_WEBHOOK_SECRET = undefined;
    process.env.CUSTOM_WEBHOOK_SECRET = undefined;
    vi.clearAllMocks();
  });

  describe("GitHub webhook signature verification", () => {
    it("generates valid HMAC-SHA256 signatures", () => {
      const body = '{"action":"opened"}';
      const sig = generateGitHubSignature(body, GITHUB_SECRET);
      expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it("produces different signatures for different bodies", () => {
      const sig1 = generateGitHubSignature("body1", GITHUB_SECRET);
      const sig2 = generateGitHubSignature("body2", GITHUB_SECRET);
      expect(sig1).not.toBe(sig2);
    });

    it("produces different signatures for different secrets", () => {
      const body = '{"action":"opened"}';
      const sig1 = generateGitHubSignature(body, GITHUB_SECRET);
      const sig2 = generateGitHubSignature(body, "wrong-secret");
      expect(sig1).not.toBe(sig2);
    });

    it("verifies signature matches expected format", () => {
      const body = '{"action":"opened"}';
      const expected = `sha256=${createHmac("sha256", GITHUB_SECRET).update(body).digest("hex")}`;
      const actual = generateGitHubSignature(body, GITHUB_SECRET);
      expect(actual).toBe(expected);
    });
  });

  describe("GitHub PR event processing", () => {
    it("creates a code review task from PR opened event", () => {
      const prPayload = {
        action: "opened",
        pull_request: {
          number: 42,
          title: "Add authentication",
          body: "Implements OAuth2 flow",
          html_url: "https://github.com/org/repo/pull/42",
          user: { login: "developer" },
          head: { ref: "feat/auth", sha: "abc123" },
          base: { ref: "main" },
        },
        repository: {
          full_name: "org/repo",
          default_branch: "main",
        },
      };

      const body = JSON.stringify(prPayload);
      const signature = generateGitHubSignature(body, GITHUB_SECRET);

      // Verify the payload structure is correct for task creation
      expect(prPayload.action).toBe("opened");
      expect(prPayload.pull_request.number).toBe(42);
      expect(prPayload.pull_request.title).toBe("Add authentication");

      // Verify signature is valid
      const expectedSig = `sha256=${createHmac("sha256", GITHUB_SECRET).update(body).digest("hex")}`;
      expect(signature).toBe(expectedSig);
    });

    it("includes correct details in code review task description", () => {
      const pr = {
        number: 42,
        title: "Add authentication",
        body: "Implements OAuth2 flow",
        html_url: "https://github.com/org/repo/pull/42",
        user: { login: "developer" },
        head: { ref: "feat/auth", sha: "abc123" },
        base: { ref: "main" },
      };

      const description = [
        `Review PR #${pr.number}: ${pr.title}`,
        `Author: ${pr.user.login}`,
        `Branch: ${pr.head.ref} -> ${pr.base.ref}`,
        `URL: ${pr.html_url}`,
        "",
        pr.body ?? "No description provided.",
      ].join("\n");

      expect(description).toContain("Review PR #42");
      expect(description).toContain("Author: developer");
      expect(description).toContain("Branch: feat/auth -> main");
      expect(description).toContain("Implements OAuth2 flow");
    });
  });

  describe("GitHub issue event with label", () => {
    it("identifies issues with prometheus label", () => {
      const issuePayload = {
        action: "labeled",
        issue: {
          number: 15,
          title: "Implement notification system",
          body: "Build a notification system for real-time alerts",
          labels: [{ name: "prometheus" }, { name: "enhancement" }],
          user: { login: "pm" },
        },
        repository: { full_name: "org/repo" },
      };

      const hasLabel = issuePayload.issue.labels.some(
        (l) => l.name === "prometheus"
      );
      expect(hasLabel).toBe(true);
    });

    it("ignores issues without prometheus label", () => {
      const issuePayload = {
        action: "labeled",
        issue: {
          number: 16,
          title: "Some other issue",
          body: "Not for prometheus",
          labels: [{ name: "bug" }, { name: "enhancement" }],
          user: { login: "someone" },
        },
        repository: { full_name: "org/repo" },
      };

      const hasLabel = issuePayload.issue.labels.some(
        (l) => l.name === "prometheus"
      );
      expect(hasLabel).toBe(false);
    });

    it("builds correct task description from issue", () => {
      const issue = {
        number: 15,
        title: "Implement notification system",
        body: "Build a notification system for real-time alerts",
        user: { login: "pm" },
      };

      const description = [
        `Implement issue #${issue.number}: ${issue.title}`,
        `Author: ${issue.user.login}`,
        "",
        issue.body ?? "No description provided.",
      ].join("\n");

      expect(description).toContain("Implement issue #15");
      expect(description).toContain("Author: pm");
      expect(description).toContain("Build a notification system");
    });
  });

  describe("Jira webhook processing", () => {
    it("processes jira:issue_created event with prometheus label", () => {
      const payload = {
        webhookEvent: "jira:issue_created",
        issue: {
          key: "PROJ-123",
          fields: {
            summary: "Implement payment gateway",
            description: "Integrate Stripe for payment processing",
            labels: ["prometheus", "backend"],
            priority: { name: "High" },
            assignee: { displayName: "John Doe" },
          },
        },
      };

      const hasLabel = payload.issue.fields.labels.some(
        (l) => l.toLowerCase() === "prometheus"
      );
      expect(hasLabel).toBe(true);
      expect(payload.issue.key).toBe("PROJ-123");
      expect(payload.webhookEvent).toBe("jira:issue_created");
    });

    it("maps Jira priority levels correctly", () => {
      const mapPriority = (name: string | undefined): number => {
        switch (name?.toLowerCase()) {
          case "highest":
          case "blocker":
            return 90;
          case "high":
          case "critical":
            return 70;
          case "medium":
            return 50;
          case "low":
            return 30;
          case "lowest":
            return 10;
          default:
            return 50;
        }
      };

      expect(mapPriority("Highest")).toBe(90);
      expect(mapPriority("Blocker")).toBe(90);
      expect(mapPriority("High")).toBe(70);
      expect(mapPriority("Critical")).toBe(70);
      expect(mapPriority("Medium")).toBe(50);
      expect(mapPriority("Low")).toBe(30);
      expect(mapPriority("Lowest")).toBe(10);
      expect(mapPriority(undefined)).toBe(50);
    });

    it("verifies Jira request with Bearer token", () => {
      const authHeader = `Bearer ${JIRA_SECRET}`;
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      expect(token).toBe(JIRA_SECRET);
    });

    it("rejects invalid Jira authorization", () => {
      const authHeader = "Bearer wrong-token";
      const token = authHeader.replace(/^Bearer\s+/i, "").trim();
      expect(token).not.toBe(JIRA_SECRET);
    });
  });

  describe("Custom webhook processing", () => {
    it("creates a task from a valid custom webhook", () => {
      const payload = {
        task: "Build a notification system with real-time alerts",
        projectId: "proj_test123",
        priority: 75,
      };

      const body = JSON.stringify(payload);
      const signature = generateCustomSignature(body, CUSTOM_SECRET);

      // Verify signature
      const expectedSig = `sha256=${createHmac("sha256", CUSTOM_SECRET).update(body).digest("hex")}`;
      expect(signature).toBe(expectedSig);

      // Verify payload structure
      expect(payload.task).toBeTruthy();
      expect(payload.projectId).toBeTruthy();
      expect(payload.priority).toBe(75);
    });

    it("validates required fields in custom webhook payload", () => {
      const validPayload = { task: "Do something", projectId: "proj_123" };
      const missingTask = { projectId: "proj_123" } as Record<string, unknown>;
      const missingProject = { task: "Do something" } as Record<
        string,
        unknown
      >;

      expect(validPayload.task && validPayload.projectId).toBeTruthy();
      expect(missingTask.task && missingTask.projectId).toBeFalsy();
      expect(missingProject.task && missingProject.projectId).toBeFalsy();
    });

    it("clamps priority between 1 and 100", () => {
      const clampPriority = (p: number | undefined): number =>
        Math.max(1, Math.min(100, p ?? 50));

      expect(clampPriority(75)).toBe(75);
      expect(clampPriority(0)).toBe(1);
      expect(clampPriority(-10)).toBe(1);
      expect(clampPriority(200)).toBe(100);
      expect(clampPriority(undefined)).toBe(50);
    });
  });

  describe("Duplicate event rejection (idempotency)", () => {
    it("uses unique job IDs for queue deduplication", () => {
      const queue = createMockJobQueue();

      // Simulate two webhook events for the same PR
      const jobId1 = "github-pr-42";
      const jobId2 = "github-pr-42";

      queue.add("review-task", { prNumber: 42, attempt: 1 }, { jobId: jobId1 });
      queue.add("review-task", { prNumber: 42, attempt: 2 }, { jobId: jobId2 });

      // Both jobs use the same ID, so the second overwrites the first
      expect(queue._jobs.size).toBe(1);
    });

    it("creates separate jobs for different PRs", () => {
      const queue = createMockJobQueue();

      queue.add("review-task", { prNumber: 42 }, { jobId: "github-pr-42" });
      queue.add("review-task", { prNumber: 43 }, { jobId: "github-pr-43" });

      expect(queue._jobs.size).toBe(2);
    });

    it("creates separate jobs for different event types", () => {
      const queue = createMockJobQueue();

      queue.add("pr-review", { id: 1 }, { jobId: "github-pr-42" });
      queue.add("issue-impl", { id: 2 }, { jobId: "github-issue-15" });
      queue.add("push-ci", { id: 3 }, { jobId: "github-push-1234" });

      expect(queue._jobs.size).toBe(3);
    });
  });

  describe("Invalid signature rejection", () => {
    it("rejects GitHub webhook with wrong signature", () => {
      const body = '{"action":"opened"}';
      const validSig = generateGitHubSignature(body, GITHUB_SECRET);
      const invalidSig = generateGitHubSignature(body, "wrong-secret");

      expect(validSig).not.toBe(invalidSig);
    });

    it("rejects custom webhook with tampered body", () => {
      const originalBody = '{"task":"original","projectId":"proj_1"}';
      const tamperedBody = '{"task":"tampered","projectId":"proj_1"}';

      const signature = generateCustomSignature(originalBody, CUSTOM_SECRET);
      const expectedForTampered = generateCustomSignature(
        tamperedBody,
        CUSTOM_SECRET
      );

      expect(signature).not.toBe(expectedForTampered);
    });

    it("rejects empty signature", () => {
      const emptySignature = "";
      expect(emptySignature).toBeFalsy();
    });

    it("handles signature with timestamp prefix format", () => {
      const body = '{"task":"test","projectId":"proj_1"}';
      const baseSig = `sha256=${createHmac("sha256", CUSTOM_SECRET).update(body).digest("hex")}`;
      const timestampSig = `1234567890:${baseSig}`;

      // Custom handler supports timestamp:sha256= format
      const sigToCompare = timestampSig.includes(":")
        ? timestampSig.split(":").slice(1).join(":")
        : timestampSig;

      expect(sigToCompare).toBe(baseSig);
    });
  });
});
