/**
 * Slack Notifier
 *
 * Posts threaded progress updates to Slack channels when agent events occur.
 * Uses Slack Block Kit for rich formatting.
 *
 * Agent event types:
 * - task_started: "Starting work on this..."
 * - planning: "Planning approach: {summary}"
 * - coding: "Writing code: {file list}"
 * - testing: "Running tests..."
 * - pr_created: "Created PR: {link}"
 * - completed: "Done! PR: {link}"
 * - failed: "Ran into an issue: {error}. Need help?"
 * - approval_required: Posts approve/reject buttons
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("api:notifications:slack-notifier");

const SLACK_API = "https://slack.com/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentEventType =
  | "approval_required"
  | "coding"
  | "completed"
  | "failed"
  | "planning"
  | "pr_created"
  | "task_started"
  | "testing";

export interface SlackNotification {
  botToken: string;
  channel: string;
  event: AgentEventType;
  metadata?: Record<string, unknown>;
  sessionId?: string;
  taskId: string;
  threadTs: string;
}

interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function postMessage(
  token: string,
  channel: string,
  threadTs: string,
  text: string,
  blocks: SlackBlock[]
): Promise<{ ok: boolean; ts?: string }> {
  try {
    const resp = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel,
        thread_ts: threadTs,
        text,
        blocks,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (resp.status === 429) {
      const retryAfter = resp.headers.get("retry-after") ?? "30";
      logger.warn({ retryAfter }, "Slack rate limit hit in notifier");
      return { ok: false };
    }

    const data = (await resp.json()) as Record<string, unknown>;
    return {
      ok: data.ok === true,
      ts: data.ts as string | undefined,
    };
  } catch (error) {
    logger.warn({ error: String(error) }, "Failed to post Slack notification");
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Status emoji and color mapping
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  AgentEventType,
  { color: string; emoji: string; label: string }
> = {
  task_started: {
    emoji: ":arrows_counterclockwise:",
    label: "Started",
    color: "#2196F3",
  },
  planning: { emoji: ":thought_balloon:", label: "Planning", color: "#9C27B0" },
  coding: { emoji: ":computer:", label: "Coding", color: "#FF9800" },
  testing: { emoji: ":test_tube:", label: "Testing", color: "#00BCD4" },
  pr_created: {
    emoji: ":git-pull-request:",
    label: "PR Created",
    color: "#8BC34A",
  },
  completed: {
    emoji: ":white_check_mark:",
    label: "Completed",
    color: "#4CAF50",
  },
  failed: { emoji: ":x:", label: "Failed", color: "#F44336" },
  approval_required: {
    emoji: ":raised_hand:",
    label: "Approval Required",
    color: "#FFC107",
  },
};

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

function buildTaskStartedBlocks(taskId: string): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":arrows_counterclockwise: *Starting work on this...*",
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Task \`${taskId}\``,
        },
      ],
    },
  ];
}

function buildPlanningBlocks(summary: string): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:thought_balloon: *Planning approach:*\n${summary}`,
      },
    },
  ];
}

function buildCodingBlocks(files: string[]): SlackBlock[] {
  const fileList =
    files.length > 0
      ? files
          .slice(0, 10)
          .map((f) => `\`${f}\``)
          .join(", ")
      : "multiple files";
  const suffix = files.length > 10 ? ` and ${files.length - 10} more` : "";

  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:computer: *Writing code:* ${fileList}${suffix}`,
      },
    },
  ];
}

function buildTestingBlocks(): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":test_tube: *Running tests...*",
      },
    },
  ];
}

function buildPRCreatedBlocks(prUrl: string, prTitle: string): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:git-pull-request: *Created PR:* <${prUrl}|${prTitle}>`,
      },
    },
  ];
}

function buildCompletedBlocks(prUrl?: string, summary?: string): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: prUrl
          ? `:white_check_mark: *Done!* PR: <${prUrl}|View Pull Request>`
          : `:white_check_mark: *Done!* ${summary ?? "Task completed successfully."}`,
      },
    },
  ];

  return blocks;
}

function buildFailedBlocks(errorMessage: string): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:x: *Ran into an issue:* ${errorMessage}\n\nNeed help? Reply in this thread or run \`/prometheus status\` to check.`,
      },
    },
  ];
}

function buildApprovalBlocks(
  sessionId: string,
  description: string
): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:raised_hand: *Approval required:*\n${description}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Approve",
            emoji: true,
          },
          style: "primary",
          action_id: "approve_action",
          value: sessionId,
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Reject",
            emoji: true,
          },
          style: "danger",
          action_id: "reject_action",
          value: sessionId,
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Main notifier
// ---------------------------------------------------------------------------

/**
 * Send a progress update to a Slack thread.
 */
export async function sendSlackNotification(
  notification: SlackNotification
): Promise<void> {
  const { botToken, channel, threadTs, event, taskId, sessionId, metadata } =
    notification;

  const config = STATUS_CONFIG[event];
  if (!config) {
    logger.warn({ event }, "Unknown agent event type for Slack notification");
    return;
  }

  let blocks: SlackBlock[];
  let fallbackText: string;

  switch (event) {
    case "task_started": {
      blocks = buildTaskStartedBlocks(taskId);
      fallbackText = "Starting work on this...";
      break;
    }
    case "planning": {
      const summary = (metadata?.summary as string) ?? "Analyzing the task...";
      blocks = buildPlanningBlocks(summary);
      fallbackText = `Planning approach: ${summary}`;
      break;
    }
    case "coding": {
      const files = (metadata?.files as string[]) ?? [];
      blocks = buildCodingBlocks(files);
      fallbackText = `Writing code: ${files.join(", ")}`;
      break;
    }
    case "testing": {
      blocks = buildTestingBlocks();
      fallbackText = "Running tests...";
      break;
    }
    case "pr_created": {
      const prUrl = (metadata?.prUrl as string) ?? "";
      const prTitle = (metadata?.prTitle as string) ?? "Pull Request";
      blocks = buildPRCreatedBlocks(prUrl, prTitle);
      fallbackText = `Created PR: ${prUrl}`;
      break;
    }
    case "completed": {
      const prUrl = metadata?.prUrl as string | undefined;
      const summary = metadata?.summary as string | undefined;
      blocks = buildCompletedBlocks(prUrl, summary);
      fallbackText = prUrl ? `Done! PR: ${prUrl}` : "Done!";
      break;
    }
    case "failed": {
      const errorMessage =
        (metadata?.error as string) ?? "An unexpected error occurred";
      blocks = buildFailedBlocks(errorMessage);
      fallbackText = `Failed: ${errorMessage}`;
      break;
    }
    case "approval_required": {
      const description =
        (metadata?.description as string) ??
        "The agent needs your approval to proceed.";
      blocks = buildApprovalBlocks(sessionId ?? "", description);
      fallbackText = `Approval required: ${description}`;
      break;
    }
    default: {
      logger.warn({ event }, "Unhandled agent event type");
      return;
    }
  }

  const result = await postMessage(
    botToken,
    channel,
    threadTs,
    fallbackText,
    blocks
  );

  if (result.ok) {
    logger.info(
      { taskId, event, channel, threadTs },
      "Slack notification sent"
    );
  } else {
    logger.warn(
      { taskId, event, channel, threadTs },
      "Failed to send Slack notification"
    );
  }
}

/**
 * Convenience: resolve the bot token for an org and send notification.
 * Uses SLACK_BOT_TOKEN env var or looks up from oauthTokens table.
 */
export async function notifySlackForTask(params: {
  channel: string;
  event: AgentEventType;
  metadata?: Record<string, unknown>;
  orgId: string;
  sessionId?: string;
  taskId: string;
  threadTs: string;
}): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  if (!botToken) {
    logger.debug("No SLACK_BOT_TOKEN configured, skipping Slack notification");
    return;
  }

  await sendSlackNotification({
    botToken,
    channel: params.channel,
    threadTs: params.threadTs,
    event: params.event,
    taskId: params.taskId,
    sessionId: params.sessionId,
    metadata: params.metadata,
  });
}
