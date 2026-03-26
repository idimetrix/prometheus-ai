/**
 * Slack Slash Commands Handler
 *
 * Handles slash commands from Slack:
 * - /prometheus status  -> Returns active tasks as Slack blocks
 * - /prometheus create [description] -> Creates a task
 * - /prometheus stop [task-id] -> Cancel a task
 * - /prometheus [description] -> Shorthand: creates a task directly
 *
 * Resolves the org from the Slack team_id using the oauthTokens table.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  db,
  oauthTokens,
  organizations,
  projects,
  sessions,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { decrypt, generateId } from "@prometheus/utils";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:webhooks:slack-commands");
const slackCommandsApp = new Hono();

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "";
const WHITESPACE_RE = /\s+/;
const SIGNATURE_VERSION = "v0";
const MAX_TIMESTAMP_DRIFT_SEC = 300;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string
): boolean {
  if (!SLACK_SIGNING_SECRET) {
    logger.warn("SLACK_SIGNING_SECRET not configured");
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_TIMESTAMP_DRIFT_SEC) {
    return false;
  }

  const sigBasestring = `${SIGNATURE_VERSION}:${timestamp}:${body}`;
  const hmac = createHmac("sha256", SLACK_SIGNING_SECRET);
  hmac.update(sigBasestring);
  const expectedSignature = `${SIGNATURE_VERSION}=${hmac.digest("hex")}`;

  if (expectedSignature.length !== signature.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrgInfo {
  botToken: string;
  id: string;
  planTier: string;
  userId: string;
}

interface SlackBlock {
  elements?: Record<string, unknown>[];
  text?: { text: string; type: string };
  type: string;
}

// ---------------------------------------------------------------------------
// Org resolution
// ---------------------------------------------------------------------------

/** Resolve org + bot token from Slack team ID. */
async function resolveOrgFromTeam(teamId: string): Promise<OrgInfo | null> {
  const token = await db.query.oauthTokens.findFirst({
    where: and(
      eq(oauthTokens.provider, "slack"),
      eq(oauthTokens.providerAccountId, teamId)
    ),
  });

  if (!token) {
    const defaultOrgId = process.env.SLACK_DEFAULT_ORG_ID;
    const envBotToken = process.env.SLACK_BOT_TOKEN;
    if (defaultOrgId && envBotToken) {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, defaultOrgId),
      });
      if (org) {
        return {
          id: org.id,
          planTier: org.planTier,
          botToken: envBotToken,
          userId: defaultOrgId,
        };
      }
    }
    return null;
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, token.orgId),
  });

  if (!org) {
    return null;
  }

  let botToken = process.env.SLACK_BOT_TOKEN ?? "";
  try {
    botToken = decrypt(token.accessToken);
  } catch {
    logger.warn(
      { orgId: org.id },
      "Failed to decrypt Slack token, using env SLACK_BOT_TOKEN"
    );
  }

  return {
    id: org.id,
    planTier: org.planTier,
    botToken,
    userId: token.userId,
  };
}

// ---------------------------------------------------------------------------
// Block builders
// ---------------------------------------------------------------------------

function buildStatusBlocks(
  activeTasks: Array<{
    id: string;
    priority: number;
    status: string;
    title: string;
  }>
): SlackBlock[] {
  if (activeTasks.length === 0) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "No active tasks right now. Use `/prometheus <task description>` to start one.",
        },
      },
    ];
  }

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Active Tasks (${activeTasks.length}):*`,
      },
    },
  ];

  for (const task of activeTasks) {
    let statusIcon = ":white_circle:";
    if (task.status === "running") {
      statusIcon = ":arrows_counterclockwise:";
    } else if (task.status === "queued") {
      statusIcon = ":hourglass:";
    }

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${statusIcon} \`${task.id}\` -- *${task.title}* (priority: ${task.priority})`,
      },
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleStatusCommand(orgId: string): Promise<{
  blocks: SlackBlock[];
  response_type: string;
  text: string;
}> {
  const activeTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
    })
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), eq(tasks.status, "running")))
    .orderBy(desc(tasks.createdAt))
    .limit(10);

  const queuedTasks = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      priority: tasks.priority,
    })
    .from(tasks)
    .where(and(eq(tasks.orgId, orgId), eq(tasks.status, "queued")))
    .orderBy(desc(tasks.createdAt))
    .limit(10);

  const allTasks = [...activeTasks, ...queuedTasks];

  return {
    response_type: "ephemeral",
    text: `Active tasks: ${allTasks.length}`,
    blocks: buildStatusBlocks(allTasks),
  };
}

async function handleCreateCommand(
  org: OrgInfo,
  description: string,
  slackUserId: string
): Promise<{
  blocks: SlackBlock[];
  response_type: string;
  text: string;
}> {
  if (!description) {
    return {
      response_type: "ephemeral",
      text: "Please provide a task description",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Usage: `/prometheus create <task description>`\n\nOr just: `/prometheus <task description>`",
          },
        },
      ],
    };
  }

  const project = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.orgId, org.id))
    .limit(1);

  if (!project[0]) {
    return {
      response_type: "ephemeral",
      text: "No project found for your organization",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: ":warning: No project found. Please create a project first at your Prometheus dashboard.",
          },
        },
      ],
    };
  }

  const taskId = generateId("task");
  const sessionId = generateId("ses");
  const proj = project[0];

  await db.insert(sessions).values({
    id: sessionId,
    projectId: proj.id,
    userId: org.userId,
    status: "active",
    mode: "task",
  });

  await db.insert(tasks).values({
    id: taskId,
    sessionId,
    projectId: proj.id,
    orgId: proj.orgId,
    title: `Slack: ${description.slice(0, 80)}`,
    description,
    status: "queued",
    priority: 50,
  });

  await agentTaskQueue.add(`slack-cmd-${taskId}`, {
    taskId,
    sessionId,
    projectId: proj.id,
    orgId: proj.orgId,
    userId: org.userId,
    title: description.slice(0, 80),
    description,
    mode: "task",
    agentRole: null,
    creditsReserved: 100,
    planTier: org.planTier as "pro",
  });

  logger.info(
    { taskId, sessionId, slackUserId },
    "Task created via slash command"
  );

  const sessionUrl = `${FRONTEND_URL}/dashboard/sessions/${sessionId}`;

  return {
    response_type: "in_channel",
    text: `Task created: ${taskId}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:rocket: *Task submitted!*\n${description}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Task \`${taskId}\` | Submitted by <@${slackUserId}> | <${sessionUrl}|Track progress>`,
          },
        ],
      },
    ],
  };
}

async function handleStopCommand(
  orgId: string,
  taskId: string
): Promise<{
  blocks: SlackBlock[];
  response_type: string;
  text: string;
}> {
  if (!taskId) {
    return {
      response_type: "ephemeral",
      text: "Please provide a task ID",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Usage: `/prometheus stop <task-id>`",
          },
        },
      ],
    };
  }

  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId.trim()), eq(tasks.orgId, orgId)),
  });

  if (!task) {
    return {
      response_type: "ephemeral",
      text: "Task not found",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:x: Task \`${taskId}\` not found or does not belong to your organization.`,
          },
        },
      ],
    };
  }

  await db
    .update(tasks)
    .set({ status: "cancelled", completedAt: new Date() })
    .where(eq(tasks.id, task.id));

  logger.info({ taskId: task.id }, "Task cancelled via slash command");

  return {
    response_type: "in_channel",
    text: `Task cancelled: ${task.id}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:octagonal_sign: *Task cancelled*\n\`${task.id}\` -- ${task.title}`,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const KNOWN_SUBCOMMANDS = new Set(["status", "create", "stop", "help"]);

slackCommandsApp.post("/", async (c) => {
  const rawBody = await c.req.text();
  const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
  const signature = c.req.header("x-slack-signature") ?? "";

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    logger.warn("Invalid Slack command signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  try {
    const formData = new URLSearchParams(rawBody);
    const commandText = formData.get("text") ?? "";
    const teamId = formData.get("team_id") ?? "";
    const slackUserId = formData.get("user_id") ?? "";

    // Resolve org from team_id
    const org = await resolveOrgFromTeam(teamId);
    if (!org) {
      return c.json({
        response_type: "ephemeral",
        text: "Your Slack workspace is not connected to Prometheus. Please connect via Settings > Integrations > Slack.",
      });
    }

    // Parse subcommand
    const parts = commandText.trim().split(WHITESPACE_RE);
    const firstWord = parts[0]?.toLowerCase() ?? "";
    const args = parts.slice(1).join(" ");

    // If the first word is not a known subcommand, treat the entire text as a task description
    const isKnownSubcommand = KNOWN_SUBCOMMANDS.has(firstWord);
    const subCommand = isKnownSubcommand ? firstWord : "create";
    const taskDescription = isKnownSubcommand ? args : commandText.trim();

    let response: {
      blocks: SlackBlock[];
      response_type: string;
      text: string;
    };

    switch (subCommand) {
      case "status":
        response = await handleStatusCommand(org.id);
        break;
      case "create":
        response = await handleCreateCommand(org, taskDescription, slackUserId);
        break;
      case "stop":
        response = await handleStopCommand(org.id, args);
        break;
      default:
        response = {
          response_type: "ephemeral",
          text: "Prometheus Slack Commands",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: [
                  "*Prometheus Slack Commands:*",
                  "",
                  "`/prometheus <task description>` -- Create a new task",
                  "`/prometheus create <description>` -- Create a new task (explicit)",
                  "`/prometheus status` -- View active tasks",
                  "`/prometheus stop <task-id>` -- Cancel a task",
                  "`/prometheus help` -- Show this help",
                ].join("\n"),
              },
            },
          ],
        };
    }

    return c.json(response);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Slack command handler failed");
    return c.json(
      {
        response_type: "ephemeral",
        text: "An error occurred processing your command. Please try again.",
      },
      500
    );
  }
});

export { slackCommandsApp };
