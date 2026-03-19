/**
 * Slack Bot Integration
 *
 * Provides Slack notifications and interactive task submission.
 * Uses Slack Web API for posting messages and handling interactions.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("notifications:slack-bot");

export interface SlackMessage {
  blocks?: SlackBlock[];
  channel: string;
  text: string;
  threadTs?: string;
}

interface SlackBlock {
  elements?: Array<{
    type: string;
    text?: { type: string; text: string };
    action_id?: string;
    value?: string;
  }>;
  text?: { type: string; text: string };
  type: string;
}

export class SlackBot {
  private readonly token: string;
  private readonly baseUrl = "https://slack.com/api";

  constructor(token?: string) {
    this.token = token ?? process.env.SLACK_BOT_TOKEN ?? "";
  }

  get isConfigured(): boolean {
    return this.token.length > 0;
  }

  async postMessage(message: SlackMessage): Promise<string | null> {
    if (!this.isConfigured) {
      logger.debug("Slack not configured, skipping message");
      return null;
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat.postMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          channel: message.channel,
          text: message.text,
          blocks: message.blocks,
          thread_ts: message.threadTs,
        }),
      });

      const data = (await response.json()) as {
        ok: boolean;
        ts?: string;
        error?: string;
      };

      if (!data.ok) {
        logger.error({ error: data.error }, "Slack message failed");
        return null;
      }

      return data.ts ?? null;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, "Slack API request failed");
      return null;
    }
  }

  async notifyTaskComplete(params: {
    channel: string;
    taskTitle: string;
    success: boolean;
    summary: string;
    taskId: string;
    threadTs?: string;
  }): Promise<void> {
    const statusEmoji = params.success ? ":white_check_mark:" : ":x:";
    const statusText = params.success ? "completed" : "failed";

    await this.postMessage({
      channel: params.channel,
      text: `Task ${statusText}: ${params.taskTitle}`,
      threadTs: params.threadTs,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${statusEmoji} *Task ${statusText}:* ${params.taskTitle}\n\n${params.summary}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "View Details" },
              action_id: "view_task",
              value: params.taskId,
            },
          ],
        },
      ],
    });
  }

  async notifyAgentCheckpoint(params: {
    channel: string;
    reason: string;
    sessionId: string;
    threadTs?: string;
  }): Promise<void> {
    await this.postMessage({
      channel: params.channel,
      text: `Agent checkpoint: ${params.reason}`,
      threadTs: params.threadTs,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:warning: *Agent Checkpoint*\n${params.reason}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Approve" },
              action_id: "approve_checkpoint",
              value: params.sessionId,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Reject" },
              action_id: "reject_checkpoint",
              value: params.sessionId,
            },
          ],
        },
      ],
    });
  }
}

export function createSlackBot(token?: string): SlackBot {
  return new SlackBot(token);
}
