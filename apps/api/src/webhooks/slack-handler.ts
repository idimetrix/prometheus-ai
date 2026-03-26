/**
 * Slack Webhook Handler
 *
 * Comprehensive handler for all Slack interaction types:
 * - Slash command: `/prometheus <task description>` -> create task
 * - App mention: `@Prometheus fix the login bug` -> create task
 * - Message action (shortcut on any message) -> create task from message
 * - Interactive buttons -> approve/reject agent actions
 *
 * Delegates to the existing Slack webhook routes for event processing
 * and adds the message_action shortcut handler.
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
import { generateId } from "@prometheus/utils";
import { and, eq } from "drizzle-orm";
import type { Context } from "hono";

const logger = createLogger("api:webhooks:slack-handler");

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "";
const SIGNATURE_VERSION = "v0";
const MAX_TIMESTAMP_DRIFT_SEC = 300;

// ---------------------------------------------------------------------------
// Slack request signature verification
// ---------------------------------------------------------------------------

export function verifySlackSignature(
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
  team_id?: string;
  token?: string;
  type: string;
}

interface SlackInteractionPayload {
  actions?: Array<{
    action_id: string;
    value?: string;
  }>;
  callback_id?: string;
  channel?: { id: string };
  message?: {
    text?: string;
    ts: string;
  };
  response_url?: string;
  team?: { id: string };
  trigger_id?: string;
  type: string;
  user: { id: string; name: string };
}

interface SlackCommandPayload {
  channel_id: string;
  command: string;
  response_url: string;
  team_id: string;
  text: string;
  trigger_id: string;
  user_id: string;
  user_name: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve org from Slack team ID using stored OAuth tokens. */
async function resolveOrgFromTeam(
  teamId: string
): Promise<{ id: string; planTier: string } | null> {
  const token = await db.query.oauthTokens.findFirst({
    where: and(
      eq(oauthTokens.provider, "slack"),
      eq(oauthTokens.providerAccountId, teamId)
    ),
  });

  if (!token) {
    // Fall back to default org
    const defaultOrgId = process.env.SLACK_DEFAULT_ORG_ID;
    if (defaultOrgId) {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, defaultOrgId),
      });
      if (org) {
        return { id: org.id, planTier: org.planTier };
      }
    }
    return null;
  }

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, token.orgId),
  });

  return org ? { id: org.id, planTier: org.planTier } : null;
}

/** Find the first project for a given org. */
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

/** Parse task description from a mention message. */
function parseTaskFromMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();
}

/** Create a session, task, and enqueue the agent job. Returns task details. */
async function createTaskFromSlack(params: {
  channel: string;
  description: string;
  orgId: string;
  planTier: string;
  projectId: string;
  slackUserId?: string;
  threadTs?: string;
  title: string;
}): Promise<{ sessionId: string; taskId: string }> {
  const taskId = generateId("task");
  const sessionId = generateId("ses");

  await db.insert(sessions).values({
    id: sessionId,
    projectId: params.projectId,
    userId: params.slackUserId ?? params.orgId,
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
    userId: params.slackUserId ?? params.orgId,
    title: params.title,
    description: params.description,
    mode: "task",
    agentRole: null,
    creditsReserved: 100,
    planTier:
      params.planTier as unknown as import("@prometheus/types").PlanTier,
  });

  logger.info(
    {
      taskId,
      sessionId,
      channel: params.channel,
      threadTs: params.threadTs,
    },
    "Task created from Slack"
  );

  return { taskId, sessionId };
}

/** Post a reply to Slack via response_url. */
async function postSlackResponse(
  responseUrl: string,
  message: {
    blocks?: unknown[];
    replace_original?: boolean;
    response_type?: string;
    text: string;
  }
): Promise<void> {
  try {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    logger.warn(
      { error: String(error), responseUrl },
      "Failed to post Slack response"
    );
  }
}

/** Post a message using the Slack Bot Token. */
async function postSlackMessage(params: {
  blocks?: unknown[];
  channel: string;
  text: string;
  thread_ts?: string;
}): Promise<{ channel?: string; ok: boolean; ts?: string }> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    logger.warn("SLACK_BOT_TOKEN not configured, cannot post message");
    return { ok: false };
  }

  try {
    const body: Record<string, unknown> = {
      channel: params.channel,
      text: params.text,
    };
    if (params.blocks) {
      body.blocks = params.blocks;
    }
    if (params.thread_ts) {
      body.thread_ts = params.thread_ts;
    }

    const resp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    const data = (await resp.json()) as Record<string, unknown>;
    return {
      ok: data.ok === true,
      ts: data.ts as string | undefined,
      channel: data.channel as string | undefined,
    };
  } catch (error) {
    logger.warn({ error: String(error) }, "Failed to post Slack message");
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

/** Handle slash command: /prometheus <task description> */
export async function handleSlashCommand(c: Context): Promise<Response> {
  const rawBody = await c.req.text();
  const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
  const signature = c.req.header("x-slack-signature") ?? "";

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    logger.warn("Invalid Slack command signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  try {
    const formData = new URLSearchParams(rawBody);
    const payload: SlackCommandPayload = {
      command: formData.get("command") ?? "",
      text: formData.get("text") ?? "",
      user_id: formData.get("user_id") ?? "",
      user_name: formData.get("user_name") ?? "",
      team_id: formData.get("team_id") ?? "",
      channel_id: formData.get("channel_id") ?? "",
      trigger_id: formData.get("trigger_id") ?? "",
      response_url: formData.get("response_url") ?? "",
    };

    const description = payload.text.trim();
    if (!description) {
      return c.json({
        response_type: "ephemeral",
        text: "Usage: `/prometheus <task description>`\n\nExamples:\n- `/prometheus fix the login bug on mobile`\n- `/prometheus add dark mode to the settings page`\n- `/prometheus write tests for the auth module`",
      });
    }

    const org = await resolveOrgFromTeam(payload.team_id);
    if (!org) {
      return c.json({
        response_type: "ephemeral",
        text: "Your Slack workspace is not connected to a Prometheus organization. Please connect via Settings > Integrations > Slack.",
      });
    }

    const project = await findDefaultProject(org.id);
    if (!project) {
      return c.json({
        response_type: "ephemeral",
        text: "No project found for your organization. Please create a project first.",
      });
    }

    const { taskId } = await createTaskFromSlack({
      channel: payload.channel_id,
      title: `Slack: ${description.slice(0, 80)}`,
      description,
      orgId: org.id,
      planTier: org.planTier,
      projectId: project.id,
      slackUserId: payload.user_id,
    });

    return c.json({
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:rocket: *Got it! Working on:* ${description}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Task \`${taskId}\` | Submitted by <@${payload.user_id}>`,
            },
          ],
        },
      ],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Slack slash command handler failed");
    return c.json({
      response_type: "ephemeral",
      text: "An error occurred processing your command. Please try again.",
    });
  }
}

/** Handle Slack Events API (app_mention, message). */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Slack event handler requires many branching paths for different event types
export async function handleSlackEvent(c: Context): Promise<Response> {
  const rawBody = await c.req.text();
  const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
  const signature = c.req.header("x-slack-signature") ?? "";

  let body: SlackEventPayload;
  try {
    body = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    logger.warn("Invalid JSON in Slack event body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Handle url_verification challenge (skip signature check)
  if (body.type === "url_verification") {
    return c.json({ challenge: body.challenge });
  }

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    logger.warn("Invalid Slack event request signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  if (body.type === "event_callback" && body.event) {
    const event = body.event;
    const teamId = body.team_id ?? "";

    try {
      const org = await resolveOrgFromTeam(teamId);
      if (!org) {
        logger.warn({ teamId }, "No org found for Slack team");
        return c.json({ ok: true });
      }

      const project = await findDefaultProject(org.id);
      if (!project) {
        logger.warn({ orgId: org.id }, "No project found for org");
        return c.json({ ok: true });
      }

      switch (event.type) {
        case "app_mention": {
          const description = parseTaskFromMention(event.text ?? "");
          if (!description) {
            break;
          }

          const { taskId } = await createTaskFromSlack({
            channel: event.channel,
            threadTs: event.thread_ts ?? event.ts,
            title: `Slack mention: ${description.slice(0, 80)}`,
            description,
            orgId: org.id,
            planTier: org.planTier,
            projectId: project.id,
            slackUserId: event.user,
          });

          await postSlackMessage({
            channel: event.channel,
            thread_ts: event.thread_ts ?? event.ts,
            text: `Got it! Working on: ${description}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `:rocket: *Got it! Working on:* ${description}`,
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
            ],
          });
          break;
        }
        case "message": {
          // Only handle DMs (channel type starting with "D")
          const description = event.text ?? "";
          if (!description) {
            break;
          }

          const { taskId } = await createTaskFromSlack({
            channel: event.channel,
            threadTs: event.ts,
            title: `Slack DM: ${description.slice(0, 80)}`,
            description,
            orgId: org.id,
            planTier: org.planTier,
            projectId: project.id,
            slackUserId: event.user,
          });

          await postSlackMessage({
            channel: event.channel,
            thread_ts: event.ts,
            text: `Got it! Working on: ${description}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `:rocket: *Got it! Working on:* ${description}`,
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
            ],
          });
          break;
        }
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
}

/** Handle Slack interactive payloads (block_actions, message_action shortcuts). */
export async function handleSlackInteraction(c: Context): Promise<Response> {
  const rawBody = await c.req.text();
  const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
  const signature = c.req.header("x-slack-signature") ?? "";

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    logger.warn("Invalid Slack interaction signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  try {
    const formData = new URLSearchParams(rawBody);
    const payloadStr = formData.get("payload");
    if (!payloadStr) {
      return c.json({ error: "Missing payload" }, 400);
    }

    const payload = JSON.parse(payloadStr) as SlackInteractionPayload;

    switch (payload.type) {
      case "block_actions": {
        await handleBlockActions(payload);
        break;
      }
      case "message_action": {
        await handleMessageAction(payload);
        break;
      }
      default:
        logger.debug(
          { type: payload.type },
          "Unhandled Slack interaction type"
        );
    }

    return c.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Slack interaction handler failed");
    return c.json({ error: "Processing failed" }, 500);
  }
}

/** Handle block_actions (approve/reject buttons). */
async function handleBlockActions(
  payload: SlackInteractionPayload
): Promise<void> {
  if (!payload.actions) {
    return;
  }

  for (const action of payload.actions) {
    const sessionId = action.value;
    if (!sessionId) {
      continue;
    }

    switch (action.action_id) {
      case "approve_action": {
        await db
          .update(sessions)
          .set({ status: "active" })
          .where(eq(sessions.id, sessionId));

        logger.info(
          { sessionId, user: payload.user.name },
          "Agent action approved via Slack"
        );

        if (payload.response_url) {
          await postSlackResponse(payload.response_url, {
            text: `:white_check_mark: Action approved by <@${payload.user.id}>`,
            replace_original: false,
          });
        }
        break;
      }
      case "reject_action": {
        await db
          .update(sessions)
          .set({ status: "cancelled", endedAt: new Date() })
          .where(eq(sessions.id, sessionId));

        logger.info(
          { sessionId, user: payload.user.name },
          "Agent action rejected via Slack"
        );

        if (payload.response_url) {
          await postSlackResponse(payload.response_url, {
            text: `:x: Action rejected by <@${payload.user.id}>`,
            replace_original: false,
          });
        }
        break;
      }
      default:
        logger.debug({ actionId: action.action_id }, "Unhandled block action");
    }
  }
}

/** Handle message_action shortcut (create task from any message). */
async function handleMessageAction(
  payload: SlackInteractionPayload
): Promise<void> {
  const messageText = payload.message?.text ?? "";
  if (!messageText) {
    if (payload.response_url) {
      await postSlackResponse(payload.response_url, {
        response_type: "ephemeral",
        text: "Cannot create a task from an empty message.",
      });
    }
    return;
  }

  const teamId = payload.team?.id ?? "";
  const org = await resolveOrgFromTeam(teamId);
  if (!org) {
    if (payload.response_url) {
      await postSlackResponse(payload.response_url, {
        response_type: "ephemeral",
        text: "Your Slack workspace is not connected to a Prometheus organization.",
      });
    }
    return;
  }

  const project = await findDefaultProject(org.id);
  if (!project) {
    if (payload.response_url) {
      await postSlackResponse(payload.response_url, {
        response_type: "ephemeral",
        text: "No project found for your organization.",
      });
    }
    return;
  }

  const channelId = payload.channel?.id ?? "";
  const threadTs = payload.message?.ts;

  const { taskId } = await createTaskFromSlack({
    channel: channelId,
    threadTs,
    title: `Slack shortcut: ${messageText.slice(0, 80)}`,
    description: messageText,
    orgId: org.id,
    planTier: org.planTier,
    projectId: project.id,
    slackUserId: payload.user.id,
  });

  if (channelId && threadTs) {
    await postSlackMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Got it! Working on: ${messageText}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:rocket: *Got it! Working on:* ${messageText.slice(0, 200)}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Task \`${taskId}\` | Created by <@${payload.user.id}> via message shortcut`,
            },
          ],
        },
      ],
    });
  }

  if (payload.response_url) {
    await postSlackResponse(payload.response_url, {
      response_type: "ephemeral",
      text: `Task created: ${taskId}`,
    });
  }
}
