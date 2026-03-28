/**
 * Slack Interactive Component Handler (GAP-022)
 *
 * Handles interactive component payloads from Slack:
 * - block_actions: Button clicks (approve/reject, view task, cancel)
 * - view_submission: Modal form submissions (task creation, feedback)
 * - shortcut: Global/message shortcuts
 *
 * This handler is mounted separately from the main Slack events webhook
 * to keep interactive payloads isolated and easier to maintain.
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
import { Hono } from "hono";

const logger = createLogger("api:webhooks:slack-interactive");
const slackInteractiveApp = new Hono();

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET ?? "";
const SIGNATURE_VERSION = "v0";
const MAX_TIMESTAMP_DRIFT_SEC = 300;
const _FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:3000";

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

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

interface SlackInteractionPayload {
  actions?: Array<{
    action_id: string;
    block_id?: string;
    value?: string;
  }>;
  channel?: { id: string };
  message?: { text?: string; ts: string };
  response_url?: string;
  team?: { id: string };
  trigger_id?: string;
  type: string;
  user: { id: string; name: string };
  view?: {
    callback_id: string;
    private_metadata?: string;
    state?: {
      values: Record<string, Record<string, { value?: string }>>;
    };
  };
}

interface OrgInfo {
  botToken: string;
  id: string;
  planTier: string;
  userId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

  return {
    id: org.id,
    planTier: org.planTier,
    botToken: process.env.SLACK_BOT_TOKEN ?? token.accessToken,
    userId: token.userId,
  };
}

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

// ---------------------------------------------------------------------------
// Block actions handler
// ---------------------------------------------------------------------------

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
      case "approve_action":
      case "approve_checkpoint": {
        await db
          .update(sessions)
          .set({ status: "active" })
          .where(eq(sessions.id, sessionId));

        logger.info(
          { sessionId, user: payload.user.name },
          "Action approved via Slack interactive"
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
          "Action rejected via Slack interactive"
        );

        if (payload.response_url) {
          await postSlackResponse(payload.response_url, {
            text: `:x: Rejected by <@${payload.user.id}>`,
            replace_original: false,
          });
        }
        break;
      }
      case "cancel_task": {
        await db
          .update(sessions)
          .set({ status: "cancelled", endedAt: new Date() })
          .where(eq(sessions.id, sessionId));

        logger.info(
          { sessionId, user: payload.user.name },
          "Task cancelled via Slack interactive button"
        );

        if (payload.response_url) {
          await postSlackResponse(payload.response_url, {
            text: `:octagonal_sign: Task cancelled by <@${payload.user.id}>`,
            replace_original: false,
          });
        }
        break;
      }
      case "view_task":
      case "view_session": {
        // These are link buttons; no server-side handling needed
        break;
      }
      default:
        logger.debug(
          { actionId: action.action_id },
          "Unhandled interactive block action"
        );
    }
  }
}

// ---------------------------------------------------------------------------
// View submission handlers (modal forms)
// ---------------------------------------------------------------------------

async function handleCreateTaskModal(
  view: NonNullable<SlackInteractionPayload["view"]>,
  teamId: string,
  userName: string
): Promise<{ response_action?: string } | null> {
  const org = await resolveOrgFromTeam(teamId);
  if (!org) {
    logger.warn({ teamId }, "No org found for Slack team in modal submit");
    return null;
  }

  const values = view.state?.values ?? {};
  const titleValue = Object.values(values.task_title ?? {})[0]?.value ?? "";
  const descValue =
    Object.values(values.task_description ?? {})[0]?.value ?? "";

  if (!titleValue) {
    return null;
  }

  const project = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.orgId, org.id))
    .limit(1);

  if (!project[0]) {
    logger.warn({ orgId: org.id }, "No project found for modal task");
    return null;
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
    title: titleValue.slice(0, 120),
    description: descValue || titleValue,
    status: "queued",
    priority: 50,
  });

  await agentTaskQueue.add(`slack-modal-${taskId}`, {
    taskId,
    sessionId,
    projectId: proj.id,
    orgId: proj.orgId,
    userId: org.userId,
    title: titleValue.slice(0, 120),
    description: descValue || titleValue,
    mode: "task",
    agentRole: null,
    creditsReserved: 100,
    planTier: org.planTier as "pro",
  });

  logger.info(
    { taskId, sessionId, user: userName },
    "Task created from Slack modal"
  );

  return { response_action: "clear" };
}

function handleFeedbackModal(
  view: NonNullable<SlackInteractionPayload["view"]>,
  userName: string
): { response_action: string } {
  const values = view.state?.values ?? {};
  const feedbackValue =
    Object.values(values.feedback_text ?? {})[0]?.value ?? "";
  const metadata = view.private_metadata
    ? (JSON.parse(view.private_metadata) as { sessionId?: string })
    : {};

  logger.info(
    {
      sessionId: metadata.sessionId,
      user: userName,
      feedbackLength: feedbackValue.length,
    },
    "Feedback submitted from Slack modal"
  );

  return { response_action: "clear" };
}

async function handleViewSubmission(
  payload: SlackInteractionPayload
): Promise<{ response_action?: string } | null> {
  const view = payload.view;
  if (!view) {
    return null;
  }

  const teamId = payload.team?.id ?? "";

  switch (view.callback_id) {
    case "create_task_modal":
      return await handleCreateTaskModal(view, teamId, payload.user.name);
    case "feedback_modal":
      return handleFeedbackModal(view, payload.user.name);
    default:
      logger.debug(
        { callbackId: view.callback_id },
        "Unhandled modal callback"
      );
      return null;
  }
}

// ---------------------------------------------------------------------------
// Route: POST /webhooks/slack-interactive
// ---------------------------------------------------------------------------

slackInteractiveApp.post("/", async (c) => {
  const rawBody = await c.req.text();
  const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
  const signature = c.req.header("x-slack-signature") ?? "";

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    logger.warn("Invalid Slack interactive request signature");
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
        return c.json({ ok: true });
      }
      case "view_submission": {
        const result = await handleViewSubmission(payload);
        if (result) {
          return c.json(result);
        }
        return c.json({ ok: true });
      }
      case "shortcut":
      case "message_action": {
        // Forward to the main interactions handler for message shortcuts
        logger.debug({ type: payload.type }, "Shortcut received");
        return c.json({ ok: true });
      }
      default:
        logger.debug(
          { type: payload.type },
          "Unhandled Slack interactive type"
        );
        return c.json({ ok: true });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Slack interactive handler failed");
    return c.json({ error: "Processing failed" }, 500);
  }
});

export { slackInteractiveApp };
