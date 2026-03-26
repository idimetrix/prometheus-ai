import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

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

  // Check for Slack rate limiting (HTTP 429)
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after") ?? "30";
    logger.warn({ method, retryAfter }, "Slack rate limit hit");
    return {
      ok: false,
      data: null,
      error: `Rate limited by Slack. Retry after ${retryAfter} seconds.`,
    };
  }

  const data = (await response.json()) as Record<string, unknown>;
  return {
    ok: data.ok === true,
    data,
    error: data.ok
      ? undefined
      : String(data.error ?? "Unknown Slack API error"),
  };
}

async function slackGet(
  method: string,
  token: string,
  params?: Record<string, string>
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const url = new URL(`${SLACK_API}/${method}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Prometheus-MCP-Gateway/1.0",
    },
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after") ?? "30";
    logger.warn({ method, retryAfter }, "Slack rate limit hit");
    return {
      ok: false,
      data: null,
      error: `Rate limited by Slack. Retry after ${retryAfter} seconds.`,
    };
  }

  const data = (await response.json()) as Record<string, unknown>;
  return {
    ok: data.ok === true,
    data,
    error: data.ok
      ? undefined
      : String(data.error ?? "Unknown Slack API error"),
  };
}

function requireToken(
  credentials?: Record<string, string>
): MCPToolResult | string {
  const token = credentials?.slack_token;
  if (!token) {
    return {
      success: false,
      error: "Slack bot token required. Provide credentials.slack_token.",
    };
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
          text: {
            type: "string",
            description: "Message text (used as fallback for blocks)",
          },
          blocks: {
            type: "array",
            description: "Slack Block Kit blocks for rich formatting",
          },
          thread_ts: {
            type: "string",
            description: "Thread timestamp for replies",
          },
        },
        required: ["channel", "text"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { channel, text, blocks, thread_ts } = input as {
        channel: string;
        text: string;
        blocks?: unknown[];
        thread_ts?: string;
      };

      const body: Record<string, unknown> = { channel, text };
      if (blocks) {
        body.blocks = blocks;
      }
      if (thread_ts) {
        body.thread_ts = thread_ts;
      }

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

  // ---- send_dm ----
  registry.register(
    {
      name: "slack_send_dm",
      adapter: "slack",
      description: "Send a direct message to a Slack user",
      inputSchema: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Slack user ID to send DM to",
          },
          text: { type: "string", description: "Message text" },
          blocks: {
            type: "array",
            description: "Slack Block Kit blocks for rich formatting",
          },
        },
        required: ["userId", "text"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { userId, text, blocks } = input as {
        userId: string;
        text: string;
        blocks?: unknown[];
      };

      // Open a DM conversation first
      const openResult = await slackFetch("conversations.open", tokenOrErr, {
        users: userId,
      });

      if (!openResult.ok) {
        return {
          success: false,
          error: `Failed to open DM: ${openResult.error}`,
        };
      }

      const channel = (
        (openResult.data as Record<string, unknown>)?.channel as
          | Record<string, unknown>
          | undefined
      )?.id;
      if (!channel) {
        return { success: false, error: "Failed to get DM channel ID" };
      }

      // Send the message
      const body: Record<string, unknown> = { channel, text };
      if (blocks) {
        body.blocks = blocks;
      }

      const sendResult = await slackFetch("chat.postMessage", tokenOrErr, body);

      if (!sendResult.ok) {
        return {
          success: false,
          error: `Slack API error: ${sendResult.error}`,
        };
      }

      const msg = sendResult.data as Record<string, unknown>;
      return {
        success: true,
        data: {
          ts: msg.ts,
          channel: msg.channel,
          dm: true,
        },
      };
    }
  );

  // ---- thread_reply ----
  registry.register(
    {
      name: "slack_thread_reply",
      adapter: "slack",
      description: "Reply to a message thread in Slack",
      inputSchema: {
        type: "object",
        properties: {
          channel: {
            type: "string",
            description: "Channel ID where the thread exists",
          },
          thread_ts: {
            type: "string",
            description: "Timestamp of the parent message",
          },
          text: { type: "string", description: "Reply text" },
          blocks: {
            type: "array",
            description: "Slack Block Kit blocks for rich formatting",
          },
          broadcast: {
            type: "boolean",
            description: "Also post to the channel (default false)",
          },
        },
        required: ["channel", "thread_ts", "text"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { channel, thread_ts, text, blocks, broadcast } = input as {
        channel: string;
        thread_ts: string;
        text: string;
        blocks?: unknown[];
        broadcast?: boolean;
      };

      const body: Record<string, unknown> = {
        channel,
        thread_ts,
        text,
      };
      if (blocks) {
        body.blocks = blocks;
      }
      if (broadcast) {
        body.reply_broadcast = true;
      }

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
          thread_ts,
          is_reply: true,
        },
      };
    }
  );

  // ---- list_channels ----
  registry.register(
    {
      name: "slack_list_channels",
      adapter: "slack",
      description: "List Slack channels the bot has access to",
      inputSchema: {
        type: "object",
        properties: {
          types: {
            type: "string",
            description:
              "Comma-separated channel types: public_channel, private_channel, mpim, im",
          },
          exclude_archived: {
            type: "boolean",
            description: "Exclude archived channels (default true)",
          },
          limit: {
            type: "number",
            description: "Number of channels to return (max 1000)",
          },
          cursor: { type: "string", description: "Pagination cursor" },
        },
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { types, exclude_archived, limit, cursor } = input as {
        types?: string;
        exclude_archived?: boolean;
        limit?: number;
        cursor?: string;
      };

      const params: Record<string, string> = {
        types: types ?? "public_channel,private_channel",
        exclude_archived: String(exclude_archived ?? true),
        limit: String(Math.min(limit ?? 100, 1000)),
      };
      if (cursor) {
        params.cursor = cursor;
      }

      const result = await slackGet("conversations.list", tokenOrErr, params);

      if (!result.ok) {
        return { success: false, error: `Slack API error: ${result.error}` };
      }

      const data = result.data as Record<string, unknown>;
      const channels = ((data.channels as Record<string, unknown>[]) ?? []).map(
        (ch) => ({
          id: ch.id,
          name: ch.name,
          is_channel: ch.is_channel,
          is_private: ch.is_private,
          is_archived: ch.is_archived,
          topic: (ch.topic as Record<string, unknown> | undefined)?.value ?? "",
          purpose:
            (ch.purpose as Record<string, unknown> | undefined)?.value ?? "",
          num_members: ch.num_members,
        })
      );

      const responseMeta = data.response_metadata as
        | Record<string, unknown>
        | undefined;

      return {
        success: true,
        data: {
          channels,
          count: channels.length,
          next_cursor: responseMeta?.next_cursor ?? null,
        },
      };
    }
  );

  // ---- post_progress_update ----
  registry.register(
    {
      name: "slack_post_progress_update",
      adapter: "slack",
      description:
        "Post a task progress update to a Slack thread with optional Approve/Reject buttons for destructive actions",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Channel ID" },
          thread_ts: {
            type: "string",
            description: "Thread timestamp to reply in",
          },
          sessionId: {
            type: "string",
            description:
              "Session ID (used as action value for approve/reject buttons)",
          },
          status: {
            type: "string",
            enum: ["progress", "completed", "failed", "needs_approval"],
          },
          message: { type: "string", description: "Update message" },
          requiresApproval: {
            type: "boolean",
            description:
              "If true, adds Approve/Reject buttons (for destructive actions)",
          },
        },
        required: ["channel", "thread_ts", "sessionId", "status", "message"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const {
        channel,
        thread_ts,
        sessionId,
        status,
        message,
        requiresApproval,
      } = input as {
        channel: string;
        thread_ts: string;
        sessionId: string;
        status: string;
        message: string;
        requiresApproval?: boolean;
      };

      const statusEmoji: Record<string, string> = {
        progress: ":hourglass_flowing_sand:",
        completed: ":white_check_mark:",
        failed: ":x:",
        needs_approval: ":warning:",
      };

      const blocks: unknown[] = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${statusEmoji[status] ?? ""} ${message}`,
          },
        },
      ];

      // Add Approve/Reject buttons for destructive actions
      if (requiresApproval || status === "needs_approval") {
        blocks.push({
          type: "actions",
          block_id: `approval_${sessionId}`,
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Approve", emoji: true },
              style: "primary",
              action_id: "approve_checkpoint",
              value: sessionId,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Reject", emoji: true },
              style: "danger",
              action_id: "reject_checkpoint",
              value: sessionId,
            },
          ],
        });
      }

      const fallbackText = `${statusEmoji[status] ?? ""} ${message}`;

      const result = await slackFetch("chat.postMessage", tokenOrErr, {
        channel,
        thread_ts,
        text: fallbackText,
        blocks,
      });

      if (!result.ok) {
        return { success: false, error: `Slack API error: ${result.error}` };
      }

      const msg = result.data as Record<string, unknown>;
      return {
        success: true,
        data: {
          ts: msg.ts,
          channel: msg.channel,
          thread_ts,
          hasApprovalButtons: requiresApproval || status === "needs_approval",
        },
      };
    }
  );

  // ---- create_channel_message (rich formatted task summary) ----
  registry.register(
    {
      name: "slack_create_channel_message",
      adapter: "slack",
      description:
        "Post a formatted task/deployment notification to a Slack channel using Block Kit",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string" },
          title: { type: "string", description: "Notification title" },
          status: {
            type: "string",
            enum: ["success", "failure", "in_progress", "warning"],
          },
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
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { channel, title, status, body, fields, url, urlLabel } = input as {
        channel: string;
        title: string;
        status: string;
        body?: string;
        fields?: Array<{ label: string; value: string }>;
        url?: string;
        urlLabel?: string;
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
          text: {
            type: "plain_text",
            text: `${statusEmoji[status] ?? ""} ${title}`,
            emoji: true,
          },
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
