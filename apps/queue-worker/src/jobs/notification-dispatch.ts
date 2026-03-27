import { createLogger } from "@prometheus/logger";

const logger = createLogger("queue-worker:notification-dispatch");

export interface NotificationEvent {
  channel: "slack" | "email" | "webhook" | "in_app";
  data: Record<string, unknown>;
  orgId: string;
  projectId?: string;
  type:
    | "task_completed"
    | "task_failed"
    | "pr_created"
    | "deployment_succeeded"
    | "deployment_failed"
    | "approval_required"
    | "sla_breach";
  userId?: string;
}

/**
 * Dispatches notifications across multiple channels when events occur.
 * Integrates with Slack, email, webhooks, and in-app notifications.
 */
export async function dispatchNotification(
  event: NotificationEvent
): Promise<void> {
  logger.info(
    { type: event.type, channel: event.channel, orgId: event.orgId },
    "Dispatching notification"
  );

  switch (event.channel) {
    case "slack":
      await dispatchSlackNotification(event);
      break;
    case "email":
      await dispatchEmailNotification(event);
      break;
    case "webhook":
      await dispatchWebhookNotification(event);
      break;
    case "in_app":
      await dispatchInAppNotification(event);
      break;
    default:
      logger.warn({ channel: event.channel }, "Unknown notification channel");
  }
}

async function dispatchSlackNotification(
  event: NotificationEvent
): Promise<void> {
  const slackWebhookUrl = event.data.slackWebhookUrl as string | undefined;
  if (!slackWebhookUrl) {
    logger.warn("No Slack webhook URL configured");
    return;
  }

  const message = formatSlackMessage(event);

  try {
    const response = await fetch(slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.error({ status: response.status }, "Slack notification failed");
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Slack notification error");
  }
}

async function dispatchEmailNotification(
  event: NotificationEvent
): Promise<void> {
  const emailServiceUrl = process.env.EMAIL_SERVICE_URL;
  if (!emailServiceUrl) {
    logger.warn("Email service URL not configured");
    return;
  }

  try {
    await fetch(`${emailServiceUrl}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: event.data.email ?? event.userId,
        subject: getEmailSubject(event),
        template: event.type,
        data: event.data,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Email notification error");
  }
}

async function dispatchWebhookNotification(
  event: NotificationEvent
): Promise<void> {
  const webhookUrl = event.data.webhookUrl as string | undefined;
  if (!webhookUrl) {
    return;
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: event.type,
        data: event.data,
        timestamp: new Date().toISOString(),
        orgId: event.orgId,
        projectId: event.projectId,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Webhook notification error");
  }
}

function dispatchInAppNotification(event: NotificationEvent): void {
  // In-app notifications are stored in the database and delivered via WebSocket
  logger.info(
    { type: event.type, userId: event.userId },
    "In-app notification queued"
  );
}

function formatSlackMessage(event: NotificationEvent): Record<string, unknown> {
  const projectName = (event.data.projectName as string) ?? "Unknown project";

  switch (event.type) {
    case "task_completed":
      return {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:white_check_mark: *Task Completed*\nProject: ${projectName}\nTask: ${event.data.taskTitle ?? "Unknown"}`,
            },
          },
        ],
      };
    case "task_failed":
      return {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:x: *Task Failed*\nProject: ${projectName}\nTask: ${event.data.taskTitle ?? "Unknown"}\nError: ${event.data.error ?? "Unknown error"}`,
            },
          },
        ],
      };
    case "pr_created":
      return {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:merged: *PR Created*\nProject: ${projectName}\nPR: <${event.data.prUrl}|${event.data.prTitle}>`,
            },
          },
        ],
      };
    case "approval_required":
      return {
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: *Approval Required*\nProject: ${projectName}\nAction: ${event.data.actionType}`,
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Approve" },
                style: "primary",
                action_id: "approve_action",
                value: event.data.approvalId as string,
              },
              {
                type: "button",
                text: { type: "plain_text", text: "Reject" },
                style: "danger",
                action_id: "reject_action",
                value: event.data.approvalId as string,
              },
            ],
          },
        ],
      };
    default:
      return {
        text: `[${event.type}] ${projectName}: ${JSON.stringify(event.data)}`,
      };
  }
}

function getEmailSubject(event: NotificationEvent): string {
  const projectName = (event.data.projectName as string) ?? "Prometheus";
  switch (event.type) {
    case "task_completed":
      return `[${projectName}] Task completed: ${event.data.taskTitle}`;
    case "task_failed":
      return `[${projectName}] Task failed: ${event.data.taskTitle}`;
    case "pr_created":
      return `[${projectName}] New PR: ${event.data.prTitle}`;
    case "deployment_succeeded":
      return `[${projectName}] Deployment succeeded`;
    case "deployment_failed":
      return `[${projectName}] Deployment failed`;
    case "approval_required":
      return `[${projectName}] Approval required: ${event.data.actionType}`;
    case "sla_breach":
      return `[${projectName}] SLA breach warning`;
    default:
      return `[${projectName}] Notification`;
  }
}
