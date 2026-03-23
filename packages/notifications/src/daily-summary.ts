import { createLogger } from "@prometheus/logger";

const logger = createLogger("notifications:daily-summary");

// ========== Types ==========

export interface TaskSummaryInput {
  completedAt: string | null;
  creditsConsumed: number;
  id: string;
  status: "completed" | "failed" | "cancelled" | "running" | "queued";
  title: string;
}

export interface DailySummary {
  completedCount: number;
  creditsConsumed: number;
  failedCount: number;
  notableFailures: Array<{ id: string; title: string }>;
  orgId: string;
  pendingCount: number;
  periodEnd: string;
  periodStart: string;
  successRate: number;
  totalCount: number;
}

export interface SlackSummaryBlocks {
  blocks: SlackBlock[];
  text: string;
}

interface SlackBlock {
  elements?: Array<{
    type: string;
    text?: string;
  }>;
  fields?: Array<{ type: string; text: string }>;
  text?: { type: string; text: string };
  type: string;
}

// ========== Core Functions ==========

/**
 * Aggregate task data from the last 24h into a daily summary for an org.
 */
export function generateDailySummary(
  orgId: string,
  taskList: TaskSummaryInput[]
): DailySummary {
  const now = new Date();
  const periodEnd = now.toISOString();
  const periodStart = new Date(
    now.getTime() - 24 * 60 * 60 * 1000
  ).toISOString();

  const completedCount = taskList.filter(
    (t) => t.status === "completed"
  ).length;
  const failedCount = taskList.filter((t) => t.status === "failed").length;
  const cancelledCount = taskList.filter(
    (t) => t.status === "cancelled"
  ).length;
  const pendingCount = taskList.filter(
    (t) => t.status === "running" || t.status === "queued"
  ).length;

  const totalFinished = completedCount + failedCount + cancelledCount;
  const successRate =
    totalFinished > 0 ? Math.round((completedCount / totalFinished) * 100) : 0;

  const creditsConsumed = taskList.reduce(
    (sum, t) => sum + (t.creditsConsumed ?? 0),
    0
  );

  const notableFailures = taskList
    .filter((t) => t.status === "failed")
    .slice(0, 5)
    .map((t) => ({ id: t.id, title: t.title }));

  logger.info(
    {
      orgId,
      totalCount: taskList.length,
      completedCount,
      failedCount,
      pendingCount,
    },
    "Generated daily summary"
  );

  return {
    orgId,
    periodStart,
    periodEnd,
    totalCount: taskList.length,
    completedCount,
    failedCount,
    pendingCount,
    successRate,
    creditsConsumed,
    notableFailures,
  };
}

/**
 * Format a daily summary into Slack Block Kit message format.
 */
export function formatSlackSummary(summary: DailySummary): SlackSummaryBlocks {
  const successIcon =
    summary.successRate >= 90 ? ":white_check_mark:" : ":warning:";
  const headerText = `${successIcon} Daily Summary — ${summary.successRate}% success rate`;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Daily Task Summary",
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Total Tasks:*\n${summary.totalCount}`,
        },
        {
          type: "mrkdwn",
          text: `*Success Rate:*\n${summary.successRate}%`,
        },
        {
          type: "mrkdwn",
          text: `*Completed:*\n${summary.completedCount}`,
        },
        {
          type: "mrkdwn",
          text: `*Failed:*\n${summary.failedCount}`,
        },
        {
          type: "mrkdwn",
          text: `*Pending:*\n${summary.pendingCount}`,
        },
        {
          type: "mrkdwn",
          text: `*Credits Used:*\n${summary.creditsConsumed}`,
        },
      ],
    },
  ];

  // Add notable failures section if any
  if (summary.notableFailures.length > 0) {
    const failureList = summary.notableFailures
      .map((f) => `• \`${f.id}\` — ${f.title}`)
      .join("\n");

    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Notable Failures:*\n${failureList}`,
        },
      }
    );
  }

  // Footer with time range
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Period: ${summary.periodStart.slice(0, 16)} — ${summary.periodEnd.slice(0, 16)} UTC`,
      },
    ],
  });

  return {
    text: headerText,
    blocks,
  };
}
