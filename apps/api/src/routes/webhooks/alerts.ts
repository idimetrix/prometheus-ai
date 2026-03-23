import { createLogger } from "@prometheus/logger";
import { notificationQueue } from "@prometheus/queue";
import { Hono } from "hono";

const logger = createLogger("api:webhooks:alerts");

interface AlertmanagerPayload {
  alerts: Array<{
    annotations: Record<string, string>;
    endsAt: string;
    labels: Record<string, string>;
    startsAt: string;
    status: "firing" | "resolved";
  }>;
  commonAnnotations: Record<string, string>;
  commonLabels: Record<string, string>;
  groupKey: string;
  receiver: string;
  status: "firing" | "resolved";
}

export const alertsWebhookApp = new Hono();

alertsWebhookApp.post("/", async (c) => {
  const payload = await c.req.json<AlertmanagerPayload>();

  logger.info(
    {
      status: payload.status,
      alertCount: payload.alerts.length,
      receiver: payload.receiver,
    },
    "Received Alertmanager webhook"
  );

  for (const alert of payload.alerts) {
    const severity = alert.labels.severity ?? "info";
    const alertName = alert.labels.alertname ?? "unknown";

    logger.info(
      {
        alertName,
        severity,
        status: alert.status,
      },
      "Processing alert"
    );

    // Queue notification for critical alerts
    if (severity === "critical" && alert.status === "firing") {
      await notificationQueue.add(`alert:${alertName}`, {
        type: "security_alert",
        userId: "__admin__",
        orgId: "__system__",
        channel: "both",
        data: {
          alertName,
          severity,
          summary: alert.annotations.summary ?? alertName,
          description: alert.annotations.description ?? "",
          startsAt: alert.startsAt,
          labels: alert.labels,
        },
      });
    }
  }

  return c.json({ status: "ok", processed: payload.alerts.length });
});
