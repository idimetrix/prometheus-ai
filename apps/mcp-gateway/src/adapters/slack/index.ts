import { createLogger } from "@prometheus/logger";
import type { ToolRegistry, MCPToolResult } from "../../registry";

const logger = createLogger("mcp-gateway:slack");

const SLACK_API = "https://slack.com/api";

async function slackFetch(
  method: string,
  token: string,
  body: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "Prometheus-MCP-Gateway/1.0",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json() as Record<string, unknown>;
  return {
    ok: data.ok === true,
    data,
    error: data.ok ? undefined : String(data.error ?? "Unknown Slack API error"),
  };
}

function requireToken(credentials?: Record<string, string>): MCPToolResult | string {
  const token = credentials?.slack_token;
  if (!token) {
    return { success: false, error: "Slack bot token required. Provide credentials.slack_token." };
  }
  return token;
}

export function registerSlackAdapter(registry: ToolRegistry): void {
  // ---- send_message ----
  registry.register(
    {
      name: "slack_send_message",
      adapter: "slack",
      description: "Send a message to a Slack channel",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel ID or name" },
          text: { type: "string", description: "Message text (used as fallback for blocks)" },
          blocks: {
            type: "array",
            description: "Slack Block Kit blocks for rich formatting",
          },
          thread_ts: { type: "string", description: "Thread timestamp for replies" },
        },
        required: ["channel", "text"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") return tokenOrErr;

      const { channel, text, blocks, thread_ts } = input as {
        channel: string; text: string; blocks?: unknown[]; thread_ts?: string;
      };

      const body: Record<string, unknown> = { channel, text };
      if (blocks) body.blocks = blocks;
      if (thread_ts) body.thread_ts = thread_ts;

      const result = await slackFetch("chat.postMessage", tokenOrErr, body);

      if (!result.ok) {
        return { success: false, error: `Slack API error: ${result.error}` };
      }

      const msg = result.data as Record<string, unknown>;
      return {
        success: true,
        data: {
          ts: msg.ts,
          channel: msg.channel,
        },
      };
    }
  );

  // ---- create_channel_message (rich formatted task summary) ----
  registry.register(
    {
      name: "slack_create_channel_message",
      adapter: "slack",
      description: "Post a formatted task/deployment notification to a Slack channel using Block Kit",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string" },
          title: { type: "string", description: "Notification title" },
          status: { type: "string", enum: ["success", "failure", "in_progress", "warning"] },
          body: { type: "string", description: "Main message body" },
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "string" },
              },
            },
            description: "Key-value fields to display",
          },
          url: { type: "string", description: "Optional link URL" },
          urlLabel: { type: "string", description: "Optional link label" },
        },
        required: ["channel", "title", "status"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") return tokenOrErr;

      const { channel, title, status, body, fields, url, urlLabel } = input as {
        channel: string; title: string; status: string;
        body?: string; fields?: Array<{ label: string; value: string }>;
        url?: string; urlLabel?: string;
      };

      const statusEmoji: Record<string, string> = {
        success: ":white_check_mark:",
        failure: ":x:",
        in_progress: ":hourglass_flowing_sand:",
        warning: ":warning:",
      };

      const blocks: unknown[] = [
        {
          type: "header",
          text: { type: "plain_text", text: `${statusEmoji[status] ?? ""} ${title}`, emoji: true },
        },
      ];

      if (body) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: body },
        });
      }

      if (fields?.length) {
        blocks.push({
          type: "section",
          fields: fields.map((f) => ({
            type: "mrkdwn",
            text: `*${f.label}:*\n${f.value}`,
          })),
        });
      }

      if (url) {
        blocks.push({
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: urlLabel ?? "View Details" },
              url,
              action_id: "view_details",
            },
          ],
        });
      }

      blocks.push({ type: "divider" });

      const fallbackText = `${statusEmoji[status] ?? ""} ${title}${body ? `: ${body}` : ""}`;

      const result = await slackFetch("chat.postMessage", tokenOrErr, {
        channel,
        text: fallbackText,
        blocks,
      });

      if (!result.ok) {
        return { success: false, error: `Slack API error: ${result.error}` };
      }

      const msg = result.data as Record<string, unknown>;
      return {
        success: true,
        data: { ts: msg.ts, channel: msg.channel, posted: true },
      };
    }
  );
}
