/**
 * Slack Slash Commands Handler
 *
 * Handles slash commands from Slack:
 * - /prometheus status  -> Returns active tasks as Slack blocks
 * - /prometheus create [description] -> Creates a task
 * - /prometheus stop [task-id] -> Cancels a task
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { db, projects, sessions, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:webhooks:slack-commands");
const slackCommandsApp = new Hono();

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "";
const WHITESPACE_RE = /\s+/;
const SIGNATURE_VERSION = "v0";
const MAX_TIMESTAMP_DRIFT_SEC = 300;

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
// Slack block builders
// ---------------------------------------------------------------------------

interface SlackBlock {
  elements?: Record<string, unknown>[];
  text?: { text: string; type: string };
  type: string;
}

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
          text: "No active tasks right now. Use `/prometheus create [description]` to start one.",
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
        text: `${statusIcon} \`${task.id}\` — *${task.title}* (priority: ${task.priority})`,
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

  // Also include queued tasks
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
  orgId: string,
  description: string
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
            text: "Usage: `/prometheus create [task description]`",
          },
        },
      ],
    };
  }

  const project = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.orgId, orgId))
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
            text: ":warning: No project found. Please create a project first.",
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
    userId: proj.orgId,
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
    userId: proj.orgId,
    title: description.slice(0, 80),
    description,
    mode: "task",
    agentRole: null,
    creditsReserved: 100,
    planTier: "pro",
  });

  logger.info({ taskId, sessionId }, "Task created via slash command");

  return {
    response_type: "in_channel",
    text: `Task created: ${taskId}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:white_check_mark: *Task created*\n\`${taskId}\`\n\n${description}`,
        },
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
            text: "Usage: `/prometheus stop [task-id]`",
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
          text: `:octagonal_sign: *Task cancelled*\n\`${task.id}\` — ${task.title}`,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

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
    const orgId = process.env.SLACK_DEFAULT_ORG_ID ?? "__slack__";

    // Parse command: "status", "create [desc]", "stop [id]"
    const parts = commandText.trim().split(WHITESPACE_RE);
    const subCommand = parts[0]?.toLowerCase() ?? "status";
    const args = parts.slice(1).join(" ");

    let response: {
      blocks: SlackBlock[];
      response_type: string;
      text: string;
    };

    switch (subCommand) {
      case "status":
        response = await handleStatusCommand(orgId);
        break;
      case "create":
        response = await handleCreateCommand(orgId, args);
        break;
      case "stop":
        response = await handleStopCommand(orgId, args);
        break;
      default:
        // Treat any unrecognized subcommand as a task description:
        // `/prometheus build a REST API for users` => create task
        if (commandText.trim()) {
          response = await handleCreateCommand(orgId, commandText.trim());
        } else {
          response = {
            response_type: "ephemeral",
            text: "Unknown command",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "Available commands:\n- `/prometheus [task description]` — Create a new task\n- `/prometheus status` — View active tasks\n- `/prometheus create [description]` — Create a new task\n- `/prometheus stop [task-id]` — Cancel a task",
                },
              },
            ],
          };
        }
    }

    return c.json(response);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Slack command handler failed");
    return c.json(
      {
        response_type: "ephemeral",
        text: "An error occurred processing your command",
      },
      500
    );
  }
});

export { slackCommandsApp };
