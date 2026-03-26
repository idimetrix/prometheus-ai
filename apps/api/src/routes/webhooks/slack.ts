/**
 * Slack Events API Webhook Handler
 *
 * Handles inbound Slack events:
 * - url_verification: Responds to Slack's challenge handshake
 * - app_mention: Parses task from mention text and creates a session + task
 * - message.im: Same flow for direct messages to the bot
 * - block_actions / interactive components: Processes approval/rejection buttons
 * - message_action: Create task from message shortcut
 *
 * Resolves the org from the Slack team_id using the oauthTokens table
 * (populated during the Slack OAuth install flow).
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
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

const logger = createLogger("api:webhooks:slack");
const slackWebhookApp = new Hono();

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "";
const SIGNATURE_VERSION = "v0";
const MAX_TIMESTAMP_DRIFT_SEC = 300;
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Slack request signature verification
// ---------------------------------------------------------------------------

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
    bot_id?: string;
    channel: string;
    channel_type?: string;
    subtype?: string;
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

interface OrgInfo {
  botToken: string;
  id: string;
  planTier: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Org / token resolution
// ---------------------------------------------------------------------------

/** Resolve org + bot token from Slack team ID using stored OAuth tokens. */
async function resolveOrgFromTeam(teamId: string): Promise<OrgInfo | null> {
  const token = await db.query.oauthTokens.findFirst({
    where: and(
      eq(oauthTokens.provider, "slack"),
      eq(oauthTokens.providerAccountId, teamId)
    ),
  });

  if (!token) {
    // Fall back to env vars for single-workspace setups
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

  // Decrypt the stored bot token; fall back to env var
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
// Helpers
// ---------------------------------------------------------------------------

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

/** Parse task description from a mention message (strips the bot mention prefix). */
function parseTaskFromMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>\s*/g, "").trim();
}

/** Post a message to Slack using the bot token. */
async function postSlackMessage(params: {
  blocks?: unknown[];
  channel: string;
  text: string;
  thread_ts?: string;
  token: string;
}): Promise<{ ok: boolean; ts?: string }> {
  if (!params.token) {
    logger.warn("No Slack bot token available, cannot post message");
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
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    const data = (await resp.json()) as Record<string, unknown>;
    if (!data.ok) {
      logger.warn(
        { error: data.error, channel: params.channel },
        "Slack chat.postMessage failed"
      );
    }
    return {
      ok: data.ok === true,
      ts: data.ts as string | undefined,
    };
  } catch (error) {
    logger.warn({ error: String(error) }, "Failed to post Slack message");
    return { ok: false };
  }
}

/** Post a reply via Slack response_url. */
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

/** Build a session URL for the frontend. */
function buildSessionUrl(sessionId: string): string {
  return `${FRONTEND_URL}/dashboard/sessions/${sessionId}`;
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
  userId: string;
}): Promise<{ sessionId: string; taskId: string }> {
  const taskId = generateId("task");
  const sessionId = generateId("ses");

  await db.insert(sessions).values({
    id: sessionId,
    projectId: params.projectId,
    userId: params.userId,
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
    userId: params.userId,
    title: params.title,
    description: params.description,
    mode: "task",
    agentRole: null,
    creditsReserved: 100,
    planTier: params.planTier as "pro",
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

// ---------------------------------------------------------------------------
// Event route: POST /webhooks/slack (events)
// ---------------------------------------------------------------------------

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Slack event handler requires branching for different event types
slackWebhookApp.post("/", async (c) => {
  const rawBody = await c.req.text();
  const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
  const signature = c.req.header("x-slack-signature") ?? "";

  let body: SlackEventPayload;
  try {
    body = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    logger.warn("Invalid JSON in Slack webhook body");
    return c.json({ error: "Invalid JSON" }, 400);
  }

  // Handle url_verification challenge (skip signature check for initial setup)
  if (body.type === "url_verification") {
    return c.json({ challenge: body.challenge });
  }

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    logger.warn("Invalid Slack request signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Handle event_callback
  if (body.type === "event_callback" && body.event) {
    const event = body.event;
    const teamId = body.team_id ?? "";

    // Ignore bot messages to prevent loops
    if (event.bot_id || event.subtype === "bot_message") {
      return c.json({ ok: true });
    }

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

          const { taskId, sessionId } = await createTaskFromSlack({
            channel: event.channel,
            threadTs: event.thread_ts ?? event.ts,
            title: `Slack mention: ${description.slice(0, 80)}`,
            description,
            orgId: org.id,
            planTier: org.planTier,
            projectId: project.id,
            slackUserId: event.user,
            userId: org.userId,
          });

          const sessionUrl = buildSessionUrl(sessionId);
          await postSlackMessage({
            token: org.botToken,
            channel: event.channel,
            thread_ts: event.thread_ts ?? event.ts,
            text: `Working on it: ${description}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `:rocket: *Working on it:* ${description}`,
                },
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `Task \`${taskId}\` | <${sessionUrl}|Track progress>`,
                  },
                ],
              },
            ],
          });
          break;
        }
        case "message": {
          // Only process DMs (channel_type "im") to avoid responding to all messages
          if (event.channel_type && event.channel_type !== "im") {
            break;
          }
          const description = event.text ?? "";
          if (!description) {
            break;
          }

          const { taskId, sessionId } = await createTaskFromSlack({
            channel: event.channel,
            threadTs: event.ts,
            title: `Slack DM: ${description.slice(0, 80)}`,
            description,
            orgId: org.id,
            planTier: org.planTier,
            projectId: project.id,
            slackUserId: event.user,
            userId: org.userId,
          });

          const sessionUrl = buildSessionUrl(sessionId);
          await postSlackMessage({
            token: org.botToken,
            channel: event.channel,
            thread_ts: event.ts,
            text: `Working on it: ${description}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `:rocket: *Working on it:* ${description}`,
                },
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `Task \`${taskId}\` | <${sessionUrl}|Track progress>`,
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
});

// ---------------------------------------------------------------------------
// Events sub-route: POST /webhooks/slack/events
// Alias for the root handler (manifest uses /webhooks/slack/events)
// ---------------------------------------------------------------------------

slackWebhookApp.post("/events", async (c) => {
  // Forward to the root handler by re-dispatching
  const rawBody = await c.req.text();
  const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
  const signature = c.req.header("x-slack-signature") ?? "";

  let body: SlackEventPayload;
  try {
    body = JSON.parse(rawBody) as SlackEventPayload;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (body.type === "url_verification") {
    return c.json({ challenge: body.challenge });
  }

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  // For events, return 200 immediately and process async to avoid Slack's 3s timeout
  if (body.type === "event_callback" && body.event) {
    const event = body.event;
    const teamId = body.team_id ?? "";

    if (event.bot_id || event.subtype === "bot_message") {
      return c.json({ ok: true });
    }

    // Process asynchronously (fire and forget)
    processEventAsync(event, teamId).catch((err) => {
      logger.error(
        { error: String(err) },
        "Async Slack event processing failed"
      );
    });
  }

  return c.json({ ok: true });
});

/** Process a Slack event asynchronously to avoid timeout. */
async function processEventAsync(
  event: NonNullable<SlackEventPayload["event"]>,
  teamId: string
): Promise<void> {
  const org = await resolveOrgFromTeam(teamId);
  if (!org) {
    logger.warn({ teamId }, "No org found for Slack team");
    return;
  }

  const project = await findDefaultProject(org.id);
  if (!project) {
    logger.warn({ orgId: org.id }, "No project found for org");
    return;
  }

  switch (event.type) {
    case "app_mention": {
      const description = parseTaskFromMention(event.text ?? "");
      if (!description) {
        return;
      }

      const { taskId, sessionId } = await createTaskFromSlack({
        channel: event.channel,
        threadTs: event.thread_ts ?? event.ts,
        title: `Slack mention: ${description.slice(0, 80)}`,
        description,
        orgId: org.id,
        planTier: org.planTier,
        projectId: project.id,
        slackUserId: event.user,
        userId: org.userId,
      });

      const sessionUrl = buildSessionUrl(sessionId);
      await postSlackMessage({
        token: org.botToken,
        channel: event.channel,
        thread_ts: event.thread_ts ?? event.ts,
        text: `Working on it: ${description}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:rocket: *Working on it:* ${description}`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Task \`${taskId}\` | <${sessionUrl}|Track progress>`,
              },
            ],
          },
        ],
      });
      break;
    }
    case "message": {
      if (event.channel_type && event.channel_type !== "im") {
        return;
      }
      const description = event.text ?? "";
      if (!description) {
        return;
      }

      const { taskId, sessionId } = await createTaskFromSlack({
        channel: event.channel,
        threadTs: event.ts,
        title: `Slack DM: ${description.slice(0, 80)}`,
        description,
        orgId: org.id,
        planTier: org.planTier,
        projectId: project.id,
        slackUserId: event.user,
        userId: org.userId,
      });

      const sessionUrl = buildSessionUrl(sessionId);
      await postSlackMessage({
        token: org.botToken,
        channel: event.channel,
        thread_ts: event.ts,
        text: `Working on it: ${description}`,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:rocket: *Working on it:* ${description}`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Task \`${taskId}\` | <${sessionUrl}|Track progress>`,
              },
            ],
          },
        ],
      });
      break;
    }
    default:
      logger.debug({ eventType: event.type }, "Unhandled async Slack event");
  }
}

// ---------------------------------------------------------------------------
// Interactions route: POST /webhooks/slack/interactions
// Handles block_actions (approve/reject) and message_action shortcuts
// ---------------------------------------------------------------------------

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Slack interaction handler requires multiple branching paths
slackWebhookApp.post("/interactions", async (c) => {
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
        if (payload.actions) {
          for (const action of payload.actions) {
            const sessionId = action.value;
            if (!sessionId) {
              continue;
            }

            switch (action.action_id) {
              case "approve_action":
              case "approve_checkpoint": {
                await db
                  .update(sessions)
                  .set({ status: "active" })
                  .where(eq(sessions.id, sessionId));

                logger.info(
                  { sessionId, user: payload.user.name },
                  "Action approved via Slack"
                );

                if (payload.response_url) {
                  await postSlackResponse(payload.response_url, {
                    text: `:white_check_mark: Action approved by <@${payload.user.id}>`,
                    replace_original: false,
                  });
                }
                break;
              }
              case "reject_action":
              case "reject_checkpoint": {
                await db
                  .update(sessions)
                  .set({ status: "cancelled", endedAt: new Date() })
                  .where(eq(sessions.id, sessionId));

                logger.info(
                  { sessionId, user: payload.user.name },
                  "Action rejected via Slack"
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
                logger.debug(
                  { actionId: action.action_id },
                  "Unhandled block action"
                );
            }
          }
        }
        break;
      }
      case "message_action": {
        const messageText = payload.message?.text ?? "";
        if (!messageText) {
          if (payload.response_url) {
            await postSlackResponse(payload.response_url, {
              response_type: "ephemeral",
              text: "Cannot create a task from an empty message.",
            });
          }
          break;
        }

        const teamId = payload.team?.id ?? "";
        const org = await resolveOrgFromTeam(teamId);
        if (!org) {
          if (payload.response_url) {
            await postSlackResponse(payload.response_url, {
              response_type: "ephemeral",
              text: "Your Slack workspace is not connected to Prometheus. Connect via Settings > Integrations > Slack.",
            });
          }
          break;
        }

        const project = await findDefaultProject(org.id);
        if (!project) {
          if (payload.response_url) {
            await postSlackResponse(payload.response_url, {
              response_type: "ephemeral",
              text: "No project found for your organization.",
            });
          }
          break;
        }

        const channelId = payload.channel?.id ?? "";
        const threadTs = payload.message?.ts;

        const { taskId, sessionId } = await createTaskFromSlack({
          channel: channelId,
          threadTs,
          title: `Slack shortcut: ${messageText.slice(0, 80)}`,
          description: messageText,
          orgId: org.id,
          planTier: org.planTier,
          projectId: project.id,
          slackUserId: payload.user.id,
          userId: org.userId,
        });

        const sessionUrl = buildSessionUrl(sessionId);

        if (channelId && threadTs) {
          await postSlackMessage({
            token: org.botToken,
            channel: channelId,
            thread_ts: threadTs,
            text: `Working on it: ${messageText}`,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `:rocket: *Working on it:* ${messageText.slice(0, 200)}`,
                },
              },
              {
                type: "context",
                elements: [
                  {
                    type: "mrkdwn",
                    text: `Task \`${taskId}\` | Created by <@${payload.user.id}> | <${sessionUrl}|Track progress>`,
                  },
                ],
              },
            ],
          });
        }

        if (payload.response_url) {
          await postSlackResponse(payload.response_url, {
            response_type: "ephemeral",
            text: `Task created: ${taskId} - ${sessionUrl}`,
          });
        }
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
});

// ---------------------------------------------------------------------------
// Legacy actions route (kept for backward compat with existing installations)
// ---------------------------------------------------------------------------

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Slack actions handler dispatches multiple action types
slackWebhookApp.post("/actions", async (c) => {
  const rawBody = await c.req.text();
  const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
  const signature = c.req.header("x-slack-signature") ?? "";

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    logger.warn("Invalid Slack action request signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  try {
    const formData = new URLSearchParams(rawBody);
    const payloadStr = formData.get("payload");
    if (!payloadStr) {
      return c.json({ error: "Missing payload" }, 400);
    }

    const payload = JSON.parse(payloadStr) as SlackInteractionPayload;

    if (payload.actions) {
      for (const action of payload.actions) {
        const sessionId = action.value;
        if (!sessionId) {
          continue;
        }

        switch (action.action_id) {
          case "approve_action":
          case "approve_checkpoint": {
            await db
              .update(sessions)
              .set({ status: "active" })
              .where(eq(sessions.id, sessionId));

            logger.info(
              { sessionId, user: payload.user.name },
              "Checkpoint approved via Slack (legacy)"
            );

            if (payload.response_url) {
              await postSlackResponse(payload.response_url, {
                text: `:white_check_mark: Approved by <@${payload.user.id}>`,
                replace_original: false,
              });
            }
            break;
          }
          case "reject_action":
          case "reject_checkpoint": {
            await db
              .update(sessions)
              .set({ status: "cancelled", endedAt: new Date() })
              .where(eq(sessions.id, sessionId));

            logger.info(
              { sessionId, user: payload.user.name },
              "Checkpoint rejected via Slack (legacy)"
            );

            if (payload.response_url) {
              await postSlackResponse(payload.response_url, {
                text: `:x: Rejected by <@${payload.user.id}>`,
                replace_original: false,
              });
            }
            break;
          }
          default:
            logger.debug(
              { actionId: action.action_id },
              "Unhandled block action"
            );
        }
      }
    }

    return c.json({ ok: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Slack block action handler failed");
    return c.json({ error: "Action processing failed" }, 400);
  }
});

export { slackWebhookApp };
