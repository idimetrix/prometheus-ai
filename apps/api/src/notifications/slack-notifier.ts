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
 *
 * Resolves the bot token per-org from the oauthTokens table, falling back
 * to the SLACK_BOT_TOKEN env var for single-workspace setups.
 */

import { db, oauthTokens } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { decrypt } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";

const logger = createLogger("api:notifications:slack-notifier");

const SLACK_API = "https://slack.com/api";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

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
// Bot token resolution
// ---------------------------------------------------------------------------

/** Resolve the Slack bot token for a given org from the oauthTokens table. */
export async function resolveBotToken(orgId: string): Promise<string | null> {
  // 1. Try the oauthTokens table
  const token = await db.query.oauthTokens.findFirst({
    where: and(eq(oauthTokens.orgId, orgId), eq(oauthTokens.provider, "slack")),
  });

  if (token) {
    try {
      return decrypt(token.accessToken);
    } catch {
      logger.warn(
        { orgId },
        "Failed to decrypt Slack token from DB, falling back to env"
      );
    }
  }

  // 2. Fall back to env var
  const envToken = process.env.SLACK_BOT_TOKEN;
  return envToken ?? null;
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

/** Update an existing Slack message. */
async function updateMessage(
  token: string,
  channel: string,
  ts: string,
  text: string,
  blocks: SlackBlock[]
): Promise<{ ok: boolean }> {
  try {
    const resp = await fetch(`${SLACK_API}/chat.update`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel,
        ts,
        text,
        blocks,
      }),
      signal: AbortSignal.timeout(5000),
    });

    const data = (await resp.json()) as Record<string, unknown>;
    return { ok: data.ok === true };
  } catch (error) {
    logger.warn({ error: String(error) }, "Failed to update Slack message");
    return { ok: false };
  }
}

/** Add a reaction to a message. */
async function addReaction(
  token: string,
  channel: string,
  timestamp: string,
  name: string
): Promise<void> {
  try {
    await fetch(`${SLACK_API}/reactions.add`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel,
        timestamp,
        name,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Reactions are best-effort
  }
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

function buildTaskStartedBlocks(
  taskId: string,
  sessionId?: string
): SlackBlock[] {
  const sessionUrl = sessionId
    ? `${FRONTEND_URL}/dashboard/sessions/${sessionId}`
    : null;
  const trackLink = sessionUrl ? ` | <${sessionUrl}|Track progress>` : "";

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
          text: `Task \`${taskId}\`${trackLink}`,
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

function buildCompletedBlocks(
  sessionId?: string,
  prUrl?: string,
  summary?: string
): SlackBlock[] {
  const sessionUrl = sessionId
    ? `${FRONTEND_URL}/dashboard/sessions/${sessionId}`
    : null;

  let mainText: string;
  if (prUrl) {
    mainText = `:white_check_mark: *Done!* PR: <${prUrl}|View Pull Request>`;
  } else {
    mainText = `:white_check_mark: *Done!* ${summary ?? "Task completed successfully."}`;
  }

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: mainText,
      },
    },
  ];

  if (sessionUrl) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `<${sessionUrl}|View session details>`,
        },
      ],
    });
  }

  return blocks;
}

function buildFailedBlocks(errorMessage: string): SlackBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:x: *Ran into an issue:* ${errorMessage}\n\nNeed help? Reply in this thread or check the dashboard.`,
      },
    },
  ];
}

function buildApprovalBlocks(
  sessionId: string,
  description: string
): SlackBlock[] {
  const sessionUrl = `${FRONTEND_URL}/dashboard/sessions/${sessionId}`;

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
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Details",
            emoji: true,
          },
          action_id: "view_session",
          url: sessionUrl,
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

  let blocks: SlackBlock[];
  let fallbackText: string;

  switch (event) {
    case "task_started": {
      blocks = buildTaskStartedBlocks(taskId, sessionId);
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
      blocks = buildCompletedBlocks(sessionId, prUrl, summary);
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
      const _exhaustive: never = event;
      logger.warn({ event: _exhaustive }, "Unhandled agent event type");
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

    // Add a reaction for key events
    if (event === "completed") {
      await addReaction(botToken, channel, threadTs, "white_check_mark");
    } else if (event === "failed") {
      await addReaction(botToken, channel, threadTs, "x");
    }
  } else {
    logger.warn(
      { taskId, event, channel, threadTs },
      "Failed to send Slack notification"
    );
  }
}

/**
 * Convenience: resolve the bot token for an org and send notification.
 * Looks up the token from the oauthTokens table first, then falls back to env.
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
  const botToken = await resolveBotToken(params.orgId);
  if (!botToken) {
    logger.debug(
      { orgId: params.orgId },
      "No Slack bot token available, skipping notification"
    );
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

/**
 * Update an existing Slack message with new progress info.
 * Useful for updating the initial "Working on it..." message with final status.
 */
export async function updateSlackNotification(params: {
  botToken: string;
  channel: string;
  event: AgentEventType;
  messageTs: string;
  metadata?: Record<string, unknown>;
  sessionId?: string;
  taskId: string;
}): Promise<void> {
  const { botToken, channel, messageTs, event, sessionId, metadata } = params;

  let blocks: SlackBlock[];
  let fallbackText: string;

  switch (event) {
    case "completed": {
      const prUrl = metadata?.prUrl as string | undefined;
      const summary = metadata?.summary as string | undefined;
      blocks = buildCompletedBlocks(sessionId, prUrl, summary);
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
    default: {
      // For other events, just post a new threaded message instead
      logger.debug(
        { event },
        "updateSlackNotification only supports completed/failed, skipping"
      );
      return;
    }
  }

  const result = await updateMessage(
    botToken,
    channel,
    messageTs,
    fallbackText,
    blocks
  );

  if (result.ok) {
    logger.info({ event, channel, messageTs }, "Slack message updated");
  } else {
    logger.warn(
      { event, channel, messageTs },
      "Failed to update Slack message"
    );
  }
}
