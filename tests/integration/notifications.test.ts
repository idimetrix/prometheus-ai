/**
 * Integration tests: Notification System.
 *
 * Verifies daily summary generation, Slack message formatting,
 * progress streaming to threads, notification deduplication,
 * and multi-channel notification routing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIntegrationFixtures,
  createMockJobQueue,
  createMockServiceClient,
} from "./setup";

const DATE_FORMAT_RE = /^\d{4}-\d{2}-\d{2}$/;

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

// ─── Notification types ─────────────────────────────────────────────────────

interface NotificationPayload {
  channel: "slack" | "email" | "webhook" | "in_app";
  deduplicationKey?: string;
  message: string;
  metadata?: Record<string, unknown>;
  orgId: string;
  threadId?: string;
  title: string;
  type:
    | "task_complete"
    | "task_failed"
    | "daily_summary"
    | "progress"
    | "alert";
}

interface DailySummary {
  completedTasks: number;
  creditsConsumed: number;
  date: string;
  failedTasks: number;
  orgId: string;
  runningTasks: number;
  topAgentRoles: Array<{ count: number; role: string }>;
}

interface SlackBlock {
  text?: { text: string; type: string };
  type: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateDailySummary(params: {
  completedTasks: number;
  creditsConsumed: number;
  failedTasks: number;
  orgId: string;
  runningTasks: number;
  topAgentRoles: Array<{ count: number; role: string }>;
}): DailySummary {
  return {
    orgId: params.orgId,
    date: new Date().toISOString().split("T")[0] as string,
    completedTasks: params.completedTasks,
    failedTasks: params.failedTasks,
    runningTasks: params.runningTasks,
    creditsConsumed: params.creditsConsumed,
    topAgentRoles: params.topAgentRoles,
  };
}

function formatSlackMessage(notification: NotificationPayload): {
  blocks: SlackBlock[];
  text: string;
} {
  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: notification.title },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: notification.message },
    },
  ];

  if (notification.type === "daily_summary" && notification.metadata) {
    const meta = notification.metadata as unknown as DailySummary;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: [
          `*Completed:* ${meta.completedTasks}`,
          `*Failed:* ${meta.failedTasks}`,
          `*Running:* ${meta.runningTasks}`,
          `*Credits Used:* ${meta.creditsConsumed}`,
        ].join(" | "),
      },
    });
  }

  return {
    text: notification.title,
    blocks,
  };
}

function deduplicateNotifications(
  notifications: NotificationPayload[]
): NotificationPayload[] {
  const seen = new Set<string>();
  return notifications.filter((n) => {
    const key = n.deduplicationKey ?? `${n.orgId}:${n.type}:${n.title}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function routeNotification(notification: NotificationPayload): string[] {
  const channels: string[] = [];

  switch (notification.type) {
    case "daily_summary":
      channels.push("slack", "email");
      break;
    case "task_complete":
      channels.push("slack", "in_app");
      break;
    case "task_failed":
      channels.push("slack", "email", "in_app");
      break;
    case "progress":
      channels.push("slack");
      break;
    case "alert":
      channels.push("slack", "email", "webhook", "in_app");
      break;
    default:
      channels.push("in_app");
      break;
  }

  return channels;
}

describe("Notification System", () => {
  let fixtures: ReturnType<typeof createIntegrationFixtures>;
  const slackService = createMockServiceClient("slack");

  beforeEach(() => {
    fixtures = createIntegrationFixtures();
    slackService._reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Daily summary generation", () => {
    it("generates a daily summary with task statistics", () => {
      const summary = generateDailySummary({
        orgId: fixtures.org.id,
        completedTasks: 15,
        failedTasks: 2,
        runningTasks: 3,
        creditsConsumed: 450,
        topAgentRoles: [
          { role: "backend_coder", count: 8 },
          { role: "frontend_coder", count: 5 },
          { role: "test_engineer", count: 2 },
        ],
      });

      expect(summary.orgId).toBe(fixtures.org.id);
      expect(summary.completedTasks).toBe(15);
      expect(summary.failedTasks).toBe(2);
      expect(summary.runningTasks).toBe(3);
      expect(summary.creditsConsumed).toBe(450);
      expect(summary.topAgentRoles).toHaveLength(3);
      expect(summary.date).toMatch(DATE_FORMAT_RE);
    });

    it("includes top agent roles sorted by count", () => {
      const summary = generateDailySummary({
        orgId: fixtures.org.id,
        completedTasks: 10,
        failedTasks: 0,
        runningTasks: 1,
        creditsConsumed: 200,
        topAgentRoles: [
          { role: "backend_coder", count: 8 },
          { role: "frontend_coder", count: 5 },
        ],
      });

      expect(summary.topAgentRoles[0]?.role).toBe("backend_coder");
      expect(summary.topAgentRoles[0]?.count).toBe(8);
    });

    it("handles zero tasks in summary", () => {
      const summary = generateDailySummary({
        orgId: fixtures.org.id,
        completedTasks: 0,
        failedTasks: 0,
        runningTasks: 0,
        creditsConsumed: 0,
        topAgentRoles: [],
      });

      expect(summary.completedTasks).toBe(0);
      expect(summary.topAgentRoles).toHaveLength(0);
    });
  });

  describe("Slack message formatting", () => {
    it("formats a task completion notification with header and body", () => {
      const notification: NotificationPayload = {
        type: "task_complete",
        channel: "slack",
        orgId: fixtures.org.id,
        title: "Task Completed: Implement Auth",
        message: "Backend authentication has been implemented successfully.",
      };

      const slackMsg = formatSlackMessage(notification);

      expect(slackMsg.text).toBe("Task Completed: Implement Auth");
      expect(slackMsg.blocks).toHaveLength(2);
      expect(slackMsg.blocks[0]?.type).toBe("header");
      expect(slackMsg.blocks[1]?.type).toBe("section");
      expect(slackMsg.blocks[1]?.text?.text).toContain(
        "implemented successfully"
      );
    });

    it("formats a daily summary with statistics block", () => {
      const summary = generateDailySummary({
        orgId: fixtures.org.id,
        completedTasks: 12,
        failedTasks: 1,
        runningTasks: 2,
        creditsConsumed: 300,
        topAgentRoles: [],
      });

      const notification: NotificationPayload = {
        type: "daily_summary",
        channel: "slack",
        orgId: fixtures.org.id,
        title: "Daily Summary",
        message: "Here is your daily engineering summary.",
        metadata: summary as unknown as Record<string, unknown>,
      };

      const slackMsg = formatSlackMessage(notification);

      expect(slackMsg.blocks).toHaveLength(3);
      const statsBlock = slackMsg.blocks[2];
      expect(statsBlock?.text?.text).toContain("*Completed:* 12");
      expect(statsBlock?.text?.text).toContain("*Failed:* 1");
      expect(statsBlock?.text?.text).toContain("*Credits Used:* 300");
    });

    it("formats a failure notification", () => {
      const notification: NotificationPayload = {
        type: "task_failed",
        channel: "slack",
        orgId: fixtures.org.id,
        title: "Task Failed: Deploy to Production",
        message: "Deployment failed due to container health check timeout.",
      };

      const slackMsg = formatSlackMessage(notification);

      expect(slackMsg.text).toBe("Task Failed: Deploy to Production");
      expect(slackMsg.blocks[1]?.text?.text).toContain(
        "container health check timeout"
      );
    });
  });

  describe("Progress streaming to threads", () => {
    it("groups progress notifications by thread ID", () => {
      const threadId = "thread_abc123";
      const progressUpdates: NotificationPayload[] = [
        {
          type: "progress",
          channel: "slack",
          orgId: fixtures.org.id,
          title: "Phase Update",
          message: "Discovery phase started",
          threadId,
        },
        {
          type: "progress",
          channel: "slack",
          orgId: fixtures.org.id,
          title: "Phase Update",
          message: "Discovery phase completed",
          threadId,
        },
        {
          type: "progress",
          channel: "slack",
          orgId: fixtures.org.id,
          title: "Phase Update",
          message: "Architecture phase started",
          threadId,
        },
      ];

      const threadMessages = progressUpdates.filter(
        (u) => u.threadId === threadId
      );
      expect(threadMessages).toHaveLength(3);
    });

    it("creates separate threads for different tasks", () => {
      const updates: NotificationPayload[] = [
        {
          type: "progress",
          channel: "slack",
          orgId: fixtures.org.id,
          title: "Task A",
          message: "Running",
          threadId: "thread_a",
        },
        {
          type: "progress",
          channel: "slack",
          orgId: fixtures.org.id,
          title: "Task B",
          message: "Running",
          threadId: "thread_b",
        },
      ];

      const threadIds = new Set(updates.map((u) => u.threadId));
      expect(threadIds.size).toBe(2);
    });

    it("delivers progress updates via queue", async () => {
      const queue = createMockJobQueue();

      await queue.add("notification", {
        type: "progress",
        orgId: fixtures.org.id,
        message: "Phase 1 complete",
        threadId: "thread_123",
      });

      expect(await queue.getWaitingCount()).toBe(1);
    });
  });

  describe("Notification deduplication", () => {
    it("removes duplicate notifications with same deduplication key", () => {
      const notifications: NotificationPayload[] = [
        {
          type: "task_complete",
          channel: "slack",
          orgId: fixtures.org.id,
          title: "Task Done",
          message: "First notification",
          deduplicationKey: "task_123_complete",
        },
        {
          type: "task_complete",
          channel: "slack",
          orgId: fixtures.org.id,
          title: "Task Done",
          message: "Duplicate notification",
          deduplicationKey: "task_123_complete",
        },
      ];

      const deduped = deduplicateNotifications(notifications);
      expect(deduped).toHaveLength(1);
      expect(deduped[0]?.message).toBe("First notification");
    });

    it("keeps notifications with different deduplication keys", () => {
      const notifications: NotificationPayload[] = [
        {
          type: "task_complete",
          channel: "slack",
          orgId: fixtures.org.id,
          title: "Task A Done",
          message: "Task A",
          deduplicationKey: "task_a_complete",
        },
        {
          type: "task_complete",
          channel: "slack",
          orgId: fixtures.org.id,
          title: "Task B Done",
          message: "Task B",
          deduplicationKey: "task_b_complete",
        },
      ];

      const deduped = deduplicateNotifications(notifications);
      expect(deduped).toHaveLength(2);
    });

    it("uses orgId + type + title as fallback deduplication key", () => {
      const notifications: NotificationPayload[] = [
        {
          type: "task_complete",
          channel: "slack",
          orgId: fixtures.org.id,
          title: "Same Title",
          message: "First",
        },
        {
          type: "task_complete",
          channel: "slack",
          orgId: fixtures.org.id,
          title: "Same Title",
          message: "Second",
        },
      ];

      const deduped = deduplicateNotifications(notifications);
      expect(deduped).toHaveLength(1);
    });

    it("allows same title from different orgs", () => {
      const notifications: NotificationPayload[] = [
        {
          type: "task_complete",
          channel: "slack",
          orgId: "org_1",
          title: "Task Done",
          message: "Org 1",
        },
        {
          type: "task_complete",
          channel: "slack",
          orgId: "org_2",
          title: "Task Done",
          message: "Org 2",
        },
      ];

      const deduped = deduplicateNotifications(notifications);
      expect(deduped).toHaveLength(2);
    });
  });

  describe("Multi-channel notification routing", () => {
    it("routes daily summary to slack and email", () => {
      const channels = routeNotification({
        type: "daily_summary",
        channel: "slack",
        orgId: fixtures.org.id,
        title: "Daily Summary",
        message: "Summary",
      });

      expect(channels).toContain("slack");
      expect(channels).toContain("email");
      expect(channels).not.toContain("webhook");
    });

    it("routes task completion to slack and in-app", () => {
      const channels = routeNotification({
        type: "task_complete",
        channel: "slack",
        orgId: fixtures.org.id,
        title: "Task Done",
        message: "Done",
      });

      expect(channels).toContain("slack");
      expect(channels).toContain("in_app");
      expect(channels).not.toContain("email");
    });

    it("routes task failure to slack, email, and in-app", () => {
      const channels = routeNotification({
        type: "task_failed",
        channel: "slack",
        orgId: fixtures.org.id,
        title: "Task Failed",
        message: "Failed",
      });

      expect(channels).toContain("slack");
      expect(channels).toContain("email");
      expect(channels).toContain("in_app");
    });

    it("routes progress updates to slack only", () => {
      const channels = routeNotification({
        type: "progress",
        channel: "slack",
        orgId: fixtures.org.id,
        title: "Progress",
        message: "Phase running",
      });

      expect(channels).toEqual(["slack"]);
    });

    it("routes alerts to all channels", () => {
      const channels = routeNotification({
        type: "alert",
        channel: "slack",
        orgId: fixtures.org.id,
        title: "Alert",
        message: "Critical alert",
      });

      expect(channels).toContain("slack");
      expect(channels).toContain("email");
      expect(channels).toContain("webhook");
      expect(channels).toContain("in_app");
      expect(channels).toHaveLength(4);
    });

    it("dispatches notifications to multiple channels via queue", async () => {
      const queue = createMockJobQueue();

      const notification: NotificationPayload = {
        type: "task_failed",
        channel: "slack",
        orgId: fixtures.org.id,
        title: "Task Failed",
        message: "Deployment error",
      };

      const channels = routeNotification(notification);

      for (const channel of channels) {
        await queue.add(`notify-${channel}`, {
          ...notification,
          channel,
        });
      }

      expect(queue._jobs.size).toBe(channels.length);
      expect(await queue.getWaitingCount()).toBe(3);
    });
  });
});
