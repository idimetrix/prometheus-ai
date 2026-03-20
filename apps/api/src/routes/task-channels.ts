/**
 * Multi-Channel Async Task Submission
 *
 * Accept task submissions from multiple channels:
 * - Web dashboard (existing)
 * - VS Code extension
 * - CLI tool
 * - Slack command
 * - GitHub issue comment
 * - Linear/Jira webhook
 * - Direct API
 *
 * All channels normalize to a common TaskSubmission format
 * and enqueue via BullMQ.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("api:task-channels");

const PROMETHEUS_COMMAND_PREFIX = /^\/prometheus\s*/i;
const PROMETHEUS_BOT_MENTION = /@prometheus-bot\s*/gi;

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TaskChannel =
  | "web"
  | "vscode"
  | "cli"
  | "slack"
  | "github"
  | "linear"
  | "jira"
  | "api";

export interface TaskSubmission {
  agentRole?: string;
  /** Callback URL for notifications */
  callbackUrl?: string;
  channel: TaskChannel;
  createdAt: string;
  description: string;
  id: string;
  /** Maximum credits to spend */
  maxCredits?: number;
  /** Additional metadata from the channel */
  metadata: Record<string, unknown>;
  mode: string;
  orgId: string;
  /** Priority: 1 (highest) to 5 (lowest) */
  priority: number;
  projectId: string;
  title: string;
  userId: string;
}

export interface ChannelNormalizer {
  channel: TaskChannel;
  normalize(payload: unknown): TaskSubmission;
}

// ─── Normalizers ───────────────────────────────────────────────────────────────

export function normalizeSlackPayload(
  payload: {
    text: string;
    user_id: string;
    channel_id: string;
    team_id: string;
    response_url: string;
  },
  projectId: string,
  orgId: string
): TaskSubmission {
  const text = payload.text.replace(PROMETHEUS_COMMAND_PREFIX, "").trim();

  return {
    id: generateId("task"),
    title: text.slice(0, 100),
    description: text,
    mode: "full",
    projectId,
    orgId,
    userId: payload.user_id,
    channel: "slack",
    priority: 3,
    callbackUrl: payload.response_url,
    metadata: {
      slackChannel: payload.channel_id,
      slackTeam: payload.team_id,
    },
    createdAt: new Date().toISOString(),
  };
}

export function normalizeGitHubPayload(
  payload: {
    action: string;
    comment?: { body: string; user: { login: string } };
    issue?: { number: number; title: string; body: string };
    repository: { full_name: string };
  },
  projectId: string,
  orgId: string
): TaskSubmission | null {
  // Only process comments that mention @prometheus-bot
  const body = payload.comment?.body ?? payload.issue?.body ?? "";
  if (!body.includes("@prometheus-bot") && payload.action !== "labeled") {
    return null;
  }

  const description = body.replace(PROMETHEUS_BOT_MENTION, "").trim();
  if (!description) {
    return null;
  }

  return {
    id: generateId("task"),
    title: description.slice(0, 100),
    description,
    mode: "full",
    projectId,
    orgId,
    userId: payload.comment?.user.login ?? "github",
    channel: "github",
    priority: 3,
    metadata: {
      issueNumber: payload.issue?.number,
      repo: payload.repository.full_name,
    },
    createdAt: new Date().toISOString(),
  };
}

export function normalizeLinearPayload(
  payload: {
    action: string;
    data: {
      id: string;
      title: string;
      description?: string;
      assignee?: { name: string };
      labels?: Array<{ name: string }>;
      team?: { key: string };
    };
    type: string;
  },
  projectId: string,
  orgId: string
): TaskSubmission | null {
  // Only process issues with "prometheus" label
  const hasLabel = payload.data.labels?.some(
    (l) => l.name.toLowerCase() === "prometheus"
  );
  if (!hasLabel && payload.action !== "create") {
    return null;
  }

  return {
    id: generateId("task"),
    title: payload.data.title,
    description: payload.data.description ?? payload.data.title,
    mode: "full",
    projectId,
    orgId,
    userId: payload.data.assignee?.name ?? "linear",
    channel: "linear",
    priority: 3,
    metadata: {
      linearId: payload.data.id,
      teamKey: payload.data.team?.key,
    },
    createdAt: new Date().toISOString(),
  };
}

export function normalizeCLIPayload(
  payload: {
    description: string;
    mode?: string;
    agentRole?: string;
    maxCredits?: number;
  },
  projectId: string,
  orgId: string,
  userId: string
): TaskSubmission {
  return {
    id: generateId("task"),
    title: payload.description.slice(0, 100),
    description: payload.description,
    mode: payload.mode ?? "full",
    agentRole: payload.agentRole,
    projectId,
    orgId,
    userId,
    channel: "cli",
    priority: 2,
    maxCredits: payload.maxCredits,
    metadata: {},
    createdAt: new Date().toISOString(),
  };
}

export function normalizeAPIPayload(
  payload: {
    title: string;
    description: string;
    mode?: string;
    agentRole?: string;
    priority?: number;
    maxCredits?: number;
    callbackUrl?: string;
    metadata?: Record<string, unknown>;
  },
  projectId: string,
  orgId: string,
  userId: string
): TaskSubmission {
  return {
    id: generateId("task"),
    title: payload.title,
    description: payload.description,
    mode: payload.mode ?? "full",
    agentRole: payload.agentRole,
    projectId,
    orgId,
    userId,
    channel: "api",
    priority: payload.priority ?? 3,
    maxCredits: payload.maxCredits,
    callbackUrl: payload.callbackUrl,
    metadata: payload.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
}

// ─── Notification Builder ──────────────────────────────────────────────────────

export interface ProgressNotification {
  callbackUrl?: string;
  channel: TaskChannel;
  confidence: number;
  costSoFar: number;
  metadata: Record<string, unknown>;
  status:
    | "queued"
    | "started"
    | "progress"
    | "checkpoint"
    | "completed"
    | "failed";
  summary: string;
  taskId: string;
}

export function buildProgressNotification(
  submission: TaskSubmission,
  status: ProgressNotification["status"],
  details: { summary: string; cost?: number; confidence?: number }
): ProgressNotification {
  return {
    taskId: submission.id,
    channel: submission.channel,
    status,
    summary: details.summary,
    costSoFar: details.cost ?? 0,
    confidence: details.confidence ?? 0,
    callbackUrl: submission.callbackUrl,
    metadata: submission.metadata,
  };
}

/**
 * Send a progress notification back to the originating channel.
 */
export async function sendNotification(
  notification: ProgressNotification
): Promise<void> {
  const { channel, callbackUrl, taskId, status, summary } = notification;

  logger.info({ taskId, channel, status }, "Sending progress notification");

  switch (channel) {
    case "slack": {
      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: `*[${status}]* ${summary}\n_Cost: $${notification.costSoFar.toFixed(4)} | Confidence: ${(notification.confidence * 100).toFixed(0)}%_`,
              response_type: "in_channel",
            }),
            signal: AbortSignal.timeout(5000),
          });
        } catch (error) {
          logger.warn(
            { taskId, error: String(error) },
            "Slack notification failed"
          );
        }
      }
      break;
    }

    case "github": {
      const repo = notification.metadata.repo as string | undefined;
      const issueNumber = notification.metadata.issueNumber as
        | number
        | undefined;
      if (repo && issueNumber) {
        logger.info(
          { repo, issueNumber, status },
          "Would post GitHub comment (requires GH token)"
        );
      }
      break;
    }

    case "api":
    case "cli":
    case "vscode": {
      if (callbackUrl) {
        try {
          await fetch(callbackUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(notification),
            signal: AbortSignal.timeout(5000),
          });
        } catch (error) {
          logger.warn(
            { taskId, channel, error: String(error) },
            "Callback notification failed"
          );
        }
      }
      break;
    }

    default:
      break;
  }
}
