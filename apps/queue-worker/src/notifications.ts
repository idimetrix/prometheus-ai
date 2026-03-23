import { db, users } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import type { SendNotificationData } from "@prometheus/queue";
import { EventPublisher } from "@prometheus/queue";
import { eq } from "drizzle-orm";

const logger = createLogger("queue-worker:notifications");
const publisher = new EventPublisher();

interface EmailPayload {
  html: string;
  subject: string;
  to: string;
}

async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.debug("RESEND_API_KEY not configured, skipping email");
    return false;
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: "PROMETHEUS <noreply@prometheus.dev>",
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
      }),
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, "Email send failed");
      return false;
    }

    return true;
  } catch (error) {
    logger.error({ error }, "Email send error");
    return false;
  }
}

async function getUserEmail(userId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.clerkId, userId),
    columns: { email: true },
  });
  return user?.email ?? null;
}

export async function processNotification(
  job: SendNotificationData
): Promise<void> {
  const { type, userId, orgId: _orgId, channel, data } = job;

  const shouldSendInApp = channel === "in_app" || channel === "both";
  const shouldSendEmail = channel === "email" || channel === "both";

  // Send in-app notification via Socket.io/Redis pub/sub
  if (shouldSendInApp) {
    await publisher.publishNotification(userId, {
      type: (() => {
        const typeMap: Record<string, string> = {
          task_complete: "success",
          task_failed: "error",
          credits_low: "warning",
          security_alert: "error",
        };
        return typeMap[type] ?? "info";
      })(),
      title: getNotificationTitle(type),
      message: getNotificationMessage(type, data),
      data,
    });
  }

  // Send email for relevant notification types
  if (shouldSendEmail) {
    const email = await getUserEmail(userId);
    if (!email) {
      logger.debug(
        { userId, type },
        "No email found for user, skipping email notification"
      );
      return;
    }

    const emailSent = await sendEmailForType(type, email, data);
    if (emailSent) {
      logger.info({ userId, type }, "Email notification sent");
    }
  }
}

async function sendEmailForType(
  type: string,
  email: string,
  data: Record<string, unknown>
): Promise<boolean> {
  switch (type) {
    case "task_complete":
      return await sendEmail({
        to: email,
        subject: "Task Completed - PROMETHEUS",
        html: emailTemplate(
          "Task Completed",
          "Your task has been completed successfully.",
          `<p><strong>Task:</strong> ${data.title ?? data.taskId ?? "Unknown"}</p>
           <p>View the results in your PROMETHEUS dashboard.</p>`
        ),
      });

    case "task_failed":
      return sendEmail({
        to: email,
        subject: "Task Failed - PROMETHEUS",
        html: emailTemplate(
          "Task Failed",
          "A task has failed and may need your attention.",
          `<p><strong>Task:</strong> ${data.title ?? data.taskId ?? "Unknown"}</p>
           <p><strong>Error:</strong> ${data.error ?? "Unknown error"}</p>
           <p>Check your dashboard for details.</p>`
        ),
      });

    case "credits_low":
      return sendEmail({
        to: email,
        subject: "Credits Running Low - PROMETHEUS",
        html: emailTemplate(
          "Credits Running Low",
          "Your credit balance is running low.",
          `<p><strong>Remaining:</strong> ${data.balance ?? 0} credits</p>
           <p>Purchase more credits or upgrade your plan to continue using PROMETHEUS.</p>`
        ),
      });

    case "weekly_summary":
      return sendEmail({
        to: email,
        subject: "Your Weekly Summary - PROMETHEUS",
        html: emailTemplate(
          "Weekly Summary",
          `Here's what happened this week.`,
          `<p><strong>Tasks Completed:</strong> ${data.tasksCompleted ?? 0}</p>
           <p><strong>Credits Used:</strong> ${data.creditsUsed ?? 0}</p>
           <p><strong>PRs Created:</strong> ${data.prsCreated ?? 0}</p>
           <p><strong>Estimated Hours Saved:</strong> ${data.hoursSaved ?? 0}</p>`
        ),
      });

    case "invite":
      return sendEmail({
        to: email,
        subject: "You've been invited to PROMETHEUS",
        html: emailTemplate(
          "Team Invitation",
          `You've been invited to join a team on PROMETHEUS.`,
          `<p><strong>Organization:</strong> ${data.orgName ?? "Unknown"}</p>
           <p><strong>Invited by:</strong> ${data.invitedBy ?? "A team member"}</p>
           <div style="margin-top:16px;">
             <a href="${process.env.APP_URL ?? "http://localhost:3000"}/invite/${data.inviteToken ?? ""}"
                style="display:inline-block;background:#8b5cf6;color:white;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:500;">
               Accept Invitation
             </a>
           </div>`
        ),
      });

    case "security_alert":
      return sendEmail({
        to: email,
        subject: "Security Alert - PROMETHEUS",
        html: emailTemplate(
          "Security Alert",
          "A security event has been detected on your account.",
          `<p><strong>Event:</strong> ${data.event ?? "Unknown"}</p>
           <p><strong>Details:</strong> ${data.details ?? "Please review your account settings."}</p>
           <p>If this wasn't you, please change your password immediately.</p>`
        ),
      });

    default:
      logger.debug({ type }, "No email configured for notification type");
      return false;
  }
}

function getNotificationTitle(type: string): string {
  switch (type) {
    case "task_complete":
      return "Task Completed";
    case "task_failed":
      return "Task Failed";
    case "credits_low":
      return "Credits Low";
    case "queue_ready":
      return "Queue Ready";
    case "weekly_summary":
      return "Weekly Summary";
    case "invite":
      return "Team Invitation";
    case "security_alert":
      return "Security Alert";
    default:
      return "Notification";
  }
}

function getNotificationMessage(
  type: string,
  data: Record<string, unknown>
): string {
  switch (type) {
    case "task_complete":
      return `Task "${data.title ?? "Unknown"}" completed successfully.`;
    case "task_failed":
      return `Task "${data.title ?? "Unknown"}" failed: ${data.error ?? "unknown error"}`;
    case "credits_low":
      return `Your credit balance is low (${data.balance ?? 0} remaining).`;
    case "queue_ready":
      return "Your task is ready to be processed.";
    case "weekly_summary":
      return `This week: ${data.tasksCompleted ?? 0} tasks, ${data.creditsUsed ?? 0} credits.`;
    case "invite":
      return `You've been invited to join ${data.orgName ?? "a team"}.`;
    case "security_alert":
      return `Security alert: ${data.event ?? "unusual activity detected"}.`;
    default:
      return "You have a new notification.";
  }
}

function emailTemplate(title: string, subtitle: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="display:inline-block;background:#8b5cf6;color:white;font-weight:bold;font-size:18px;width:40px;height:40px;line-height:40px;border-radius:10px;">P</div>
    </div>
    <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:32px;">
      <h1 style="color:#fafafa;font-size:20px;margin:0 0 8px;">${title}</h1>
      <p style="color:#a1a1aa;font-size:14px;margin:0 0 24px;">${subtitle}</p>
      <div style="color:#d4d4d8;font-size:14px;line-height:1.6;">
        ${body}
      </div>
      <div style="margin-top:24px;">
        <a href="${process.env.APP_URL ?? "http://localhost:3000"}/dashboard"
           style="display:inline-block;background:#8b5cf6;color:white;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:500;">
          Open Dashboard
        </a>
      </div>
    </div>
    <p style="color:#52525b;font-size:12px;text-align:center;margin-top:24px;">
      PROMETHEUS - AI Engineering Platform
    </p>
  </div>
</body>
</html>`;
}
