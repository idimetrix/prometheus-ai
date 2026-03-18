import { createLogger } from "@prometheus/logger";
import { db } from "@prometheus/db";
import { users } from "@prometheus/db";
import { eq } from "drizzle-orm";
import { EventPublisher } from "@prometheus/queue";
import type { NotificationJobData } from "@prometheus/queue";

const logger = createLogger("queue-worker:notifications");
const publisher = new EventPublisher();

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
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

export async function processNotification(job: NotificationJobData): Promise<void> {
  const { type, userId, orgId, data } = job;

  // Send in-app notification via Socket.io
  await publisher.publishNotification(userId, {
    type: type === "task_complete" ? "success"
      : type === "task_failed" ? "error"
      : type === "credits_low" ? "warning"
      : "info",
    title: getNotificationTitle(type),
    message: getNotificationMessage(type, data),
    data,
  });

  // Send email for important notifications
  const email = await getUserEmail(userId);
  if (!email) return;

  switch (type) {
    case "task_complete":
      await sendEmail({
        to: email,
        subject: "Task Completed - PROMETHEUS",
        html: emailTemplate(
          "Task Completed",
          `Your task has been completed successfully.`,
          `<p><strong>Task:</strong> ${data.title ?? data.taskId ?? "Unknown"}</p>
           <p>View the results in your PROMETHEUS dashboard.</p>`,
        ),
      });
      break;

    case "task_failed":
      await sendEmail({
        to: email,
        subject: "Task Failed - PROMETHEUS",
        html: emailTemplate(
          "Task Failed",
          `A task has failed and may need your attention.`,
          `<p><strong>Task:</strong> ${data.title ?? data.taskId ?? "Unknown"}</p>
           <p><strong>Error:</strong> ${data.error ?? "Unknown error"}</p>
           <p>Check your dashboard for details.</p>`,
        ),
      });
      break;

    case "credits_low":
      await sendEmail({
        to: email,
        subject: "Credits Running Low - PROMETHEUS",
        html: emailTemplate(
          "Credits Running Low",
          `Your credit balance is running low.`,
          `<p><strong>Remaining:</strong> ${data.balance ?? 0} credits</p>
           <p>Purchase more credits or upgrade your plan to continue using PROMETHEUS.</p>`,
        ),
      });
      break;

    case "weekly_summary":
      await sendEmail({
        to: email,
        subject: "Your Weekly Summary - PROMETHEUS",
        html: emailTemplate(
          "Weekly Summary",
          `Here's what happened this week.`,
          `<p><strong>Tasks Completed:</strong> ${data.tasksCompleted ?? 0}</p>
           <p><strong>Credits Used:</strong> ${data.creditsUsed ?? 0}</p>
           <p><strong>PRs Created:</strong> ${data.prsCreated ?? 0}</p>
           <p><strong>Estimated Hours Saved:</strong> ${data.hoursSaved ?? 0}</p>`,
        ),
      });
      break;

    default:
      logger.debug({ type }, "No email configured for notification type");
  }
}

function getNotificationTitle(type: string): string {
  switch (type) {
    case "task_complete": return "Task Completed";
    case "task_failed": return "Task Failed";
    case "credits_low": return "Credits Low";
    case "queue_ready": return "Queue Ready";
    case "weekly_summary": return "Weekly Summary";
    default: return "Notification";
  }
}

function getNotificationMessage(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case "task_complete": return `Task "${data.title ?? "Unknown"}" completed successfully.`;
    case "task_failed": return `Task "${data.title ?? "Unknown"}" failed: ${data.error ?? "unknown error"}`;
    case "credits_low": return `Your credit balance is low (${data.balance ?? 0} remaining).`;
    case "queue_ready": return "Your task is ready to be processed.";
    case "weekly_summary": return `This week: ${data.tasksCompleted ?? 0} tasks, ${data.creditsUsed ?? 0} credits.`;
    default: return "You have a new notification.";
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
