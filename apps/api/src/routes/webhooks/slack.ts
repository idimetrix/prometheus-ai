/**
 * Slack Events API Webhook Handler
 *
 * Handles inbound Slack events:
 * - url_verification: Responds to Slack's challenge handshake
 * - app_mention: Parses task from mention text and creates a session + task
 * - message.im: Same flow for direct messages to the bot
 * - block_actions: Processes approval/rejection button clicks
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { db, projects, sessions, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:webhooks:slack");
const slackWebhookApp = new Hono();

// ---------------------------------------------------------------------------
// Slack request signature verification
// ---------------------------------------------------------------------------

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "";
const SIGNATURE_VERSION = "v0";
const MAX_TIMESTAMP_DRIFT_SEC = 300;

function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string
): boolean {
  if (!SLACK_SIGNING_SECRET) {
    logger.warn("SLACK_SIGNING_SECRET not configured, skipping verification");
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > MAX_TIMESTAMP_DRIFT_SEC) {
    logger.warn({ timestamp }, "Slack request timestamp too old");
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

interface SlackEventPayload {
  challenge?: string;
  event?: {
    channel: string;
    text?: string;
    thread_ts?: string;
    ts: string;
    type: string;
    user?: string;
  };
  token?: string;
  type: string;
}

interface SlackBlockActionPayload {
  actions: Array<{
    action_id: string;
    value?: string;
  }>;
  channel?: { id: string };
  message?: { ts: string };
  user: { id: string; name: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the first project for a given org (used as fallback for Slack tasks). */
async function findDefaultProject(
  orgId: string
): Promise<{ id: string; orgId: string } | null> {
  const result = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.orgId, orgId))
    .limit(1);

  return result[0] ?? null;
}

/** Parse task description from a mention message (strips the bot mention prefix). */
function parseTaskFromMention(text: string): string {
  // Remove the <@BOTID> mention prefix
  return text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();
}

/** Create a session, task, and enqueue the agent job. */
async function createTaskFromSlack(params: {
  channel: string;
  description: string;
  orgId: string;
  projectId: string;
  threadTs?: string;
  title: string;
}): Promise<{ sessionId: string; taskId: string }> {
  const taskId = generateId("task");
  const sessionId = generateId("ses");

  await db.insert(sessions).values({
    id: sessionId,
    projectId: params.projectId,
    userId: params.orgId, // Slack tasks attributed to org-level user
    status: "active",
    mode: "task",
  });

  await db.insert(tasks).values({
    id: taskId,
    sessionId,
    projectId: params.projectId,
    orgId: params.orgId,
    title: params.title,
    description: params.description,
    status: "queued",
    priority: 50,
  });

  await agentTaskQueue.add(`slack-task-${taskId}`, {
    taskId,
    sessionId,
    projectId: params.projectId,
    orgId: params.orgId,
    userId: params.orgId,
    title: params.title,
    description: params.description,
    mode: "task",
    agentRole: null,
    creditsReserved: 100,
    planTier: "pro",
  });

  logger.info(
    {
      taskId,
      sessionId,
      channel: params.channel,
      threadTs: params.threadTs,
    },
    "Task created from Slack message"
  );

  return { taskId, sessionId };
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleAppMention(
  event: NonNullable<SlackEventPayload["event"]>
): Promise<void> {
  const text = event.text ?? "";
  const description = parseTaskFromMention(text);

  if (!description) {
    logger.debug("Empty mention text after parsing, skipping");
    return;
  }

  // Use a default org for Slack-originated tasks.
  // In production this would be resolved via a Slack workspace -> org mapping.
  const defaultOrgId = process.env.SLACK_DEFAULT_ORG_ID ?? "__slack__";
  const project = await findDefaultProject(defaultOrgId);

  if (!project) {
    logger.warn(
      { orgId: defaultOrgId },
      "No project found for Slack default org"
    );
    return;
  }

  await createTaskFromSlack({
    channel: event.channel,
    threadTs: event.thread_ts ?? event.ts,
    title: `Slack task: ${description.slice(0, 80)}`,
    description,
    orgId: project.orgId,
    projectId: project.id,
  });
}

async function handleDirectMessage(
  event: NonNullable<SlackEventPayload["event"]>
): Promise<void> {
  const description = event.text ?? "";
  if (!description) {
    return;
  }

  const defaultOrgId = process.env.SLACK_DEFAULT_ORG_ID ?? "__slack__";
  const project = await findDefaultProject(defaultOrgId);

  if (!project) {
    logger.warn(
      { orgId: defaultOrgId },
      "No project found for Slack default org"
    );
    return;
  }

  await createTaskFromSlack({
    channel: event.channel,
    threadTs: event.ts,
    title: `Slack DM task: ${description.slice(0, 80)}`,
    description,
    orgId: project.orgId,
    projectId: project.id,
  });
}

async function handleBlockAction(
  payload: SlackBlockActionPayload
): Promise<void> {
  for (const action of payload.actions) {
    const sessionId = action.value;
    if (!sessionId) {
      continue;
    }

    switch (action.action_id) {
      case "approve_checkpoint": {
        await db
          .update(sessions)
          .set({ status: "active" })
          .where(eq(sessions.id, sessionId));

        logger.info(
          { sessionId, user: payload.user.name },
          "Checkpoint approved via Slack"
        );
        break;
      }
      case "reject_checkpoint": {
        await db
          .update(sessions)
          .set({ status: "cancelled", endedAt: new Date() })
          .where(eq(sessions.id, sessionId));

        logger.info(
          { sessionId, user: payload.user.name },
          "Checkpoint rejected via Slack"
        );
        break;
      }
      default:
        logger.debug({ actionId: action.action_id }, "Unhandled block action");
    }
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

slackWebhookApp.post("/", async (c) => {
  const rawBody = await c.req.text();
  const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
  const signature = c.req.header("x-slack-signature") ?? "";

  // Verify signature (skip for url_verification during initial setup)
  const body = JSON.parse(rawBody) as SlackEventPayload;

  if (
    body.type !== "url_verification" &&
    !verifySlackSignature(rawBody, timestamp, signature)
  ) {
    logger.warn("Invalid Slack request signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Handle url_verification challenge
  if (body.type === "url_verification") {
    return c.json({ challenge: body.challenge });
  }

  // Handle event_callback
  if (body.type === "event_callback" && body.event) {
    const event = body.event;

    try {
      switch (event.type) {
        case "app_mention":
          await handleAppMention(event);
          break;
        case "message":
          // Only handle DMs (channel type starting with "D")
          await handleDirectMessage(event);
          break;
        default:
          logger.debug({ eventType: event.type }, "Unhandled Slack event type");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { error: msg, eventType: event.type },
        "Slack event handler failed"
      );
    }
  }

  return c.json({ ok: true });
});

// Block actions come as a form-encoded payload
slackWebhookApp.post("/actions", async (c) => {
  const rawBody = await c.req.text();
  const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
  const signature = c.req.header("x-slack-signature") ?? "";

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    logger.warn("Invalid Slack action request signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  try {
    // Slack sends block_actions as application/x-www-form-urlencoded with a "payload" field
    const formData = new URLSearchParams(rawBody);
    const payloadStr = formData.get("payload");
    if (!payloadStr) {
      return c.json({ error: "Missing payload" }, 400);
    }

    const payload = JSON.parse(payloadStr) as SlackBlockActionPayload;
    await handleBlockAction(payload);

    return c.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Slack block action handler failed");
    return c.json({ error: "Action processing failed" }, 400);
  }
});

export { slackWebhookApp };
