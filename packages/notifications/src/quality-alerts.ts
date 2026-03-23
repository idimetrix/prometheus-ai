/**
 * Quality Alert System
 *
 * Monitors quality metrics and fires alerts when thresholds are breached.
 * Supports email, Slack, and webhook channels.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("notifications:quality-alerts");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertChannel = "email" | "slack" | "webhook";

export interface AlertRule {
  channels: AlertChannel[];
  /** "above" fires when metric > threshold, "below" when metric < threshold */
  direction: "above" | "below";
  id: string;
  metric: string;
  name: string;
  severity: AlertSeverity;
  threshold: number;
}

export interface Alert {
  firedAt: string;
  message: string;
  metric: string;
  rule: AlertRule;
  severity: AlertSeverity;
  value: number;
}

export interface MetricValues {
  [metric: string]: number;
}

interface ChannelConfig {
  email?: { to: string[] };
  slack?: { webhookUrl: string; channel: string };
  webhook?: { url: string; headers?: Record<string, string> };
}

// ---------------------------------------------------------------------------
// Built-in Rules
// ---------------------------------------------------------------------------

const BUILT_IN_RULES: AlertRule[] = [
  {
    id: "success-rate-low",
    name: "Low Success Rate",
    metric: "success_rate",
    threshold: 0.8,
    direction: "below",
    severity: "critical",
    channels: ["slack", "email"],
  },
  {
    id: "quality-score-low",
    name: "Low Quality Score",
    metric: "quality_score",
    threshold: 0.7,
    direction: "below",
    severity: "warning",
    channels: ["slack"],
  },
  {
    id: "cost-over-budget",
    name: "Cost Over Budget",
    metric: "cost_usd",
    threshold: 100,
    direction: "above",
    severity: "warning",
    channels: ["email"],
  },
];

// ---------------------------------------------------------------------------
// QualityAlertManager
// ---------------------------------------------------------------------------

export class QualityAlertManager {
  private readonly rules: AlertRule[] = [...BUILT_IN_RULES];
  private readonly channelConfig: ChannelConfig;
  private readonly firedAlerts: Alert[] = [];

  constructor(channelConfig?: ChannelConfig) {
    this.channelConfig = channelConfig ?? {};
  }

  /**
   * Add a new alert rule.
   */
  addRule(
    metric: string,
    threshold: number,
    severity: AlertSeverity,
    channels: AlertChannel[],
    options?: { name?: string; direction?: "above" | "below" }
  ): string {
    const id = `rule-${this.rules.length + 1}`;
    const rule: AlertRule = {
      id,
      name: options?.name ?? `${metric} alert`,
      metric,
      threshold,
      direction: options?.direction ?? "below",
      severity,
      channels,
    };
    this.rules.push(rule);

    logger.info(
      { ruleId: id, metric, threshold, severity },
      "Alert rule added"
    );

    return id;
  }

  /**
   * Check current metrics against all rules and fire alerts as needed.
   */
  async checkMetrics(currentMetrics: MetricValues): Promise<Alert[]> {
    const alerts: Alert[] = [];

    for (const rule of this.rules) {
      const value = currentMetrics[rule.metric];
      if (value === undefined) {
        continue;
      }

      const breached =
        rule.direction === "below"
          ? value < rule.threshold
          : value > rule.threshold;

      if (breached) {
        const alert: Alert = {
          rule,
          metric: rule.metric,
          value,
          severity: rule.severity,
          message: `${rule.name}: ${rule.metric} is ${value.toFixed(2)} (threshold: ${rule.threshold})`,
          firedAt: new Date().toISOString(),
        };

        alerts.push(alert);
        this.firedAlerts.push(alert);

        await this.sendAlert(alert, rule.channels);
      }
    }

    if (alerts.length > 0) {
      logger.info({ alertCount: alerts.length }, "Quality alerts fired");
    }

    return alerts;
  }

  /**
   * Send an alert to the specified channels.
   */
  async sendAlert(alert: Alert, channels: AlertChannel[]): Promise<void> {
    for (const channel of channels) {
      try {
        switch (channel) {
          case "slack":
            await this.sendSlack(alert);
            break;
          case "email":
            await this.sendEmail(alert);
            break;
          case "webhook":
            await this.sendWebhook(alert);
            break;
          default:
            break;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { error: msg, channel, alertId: alert.rule.id },
          "Failed to send alert"
        );
      }
    }
  }

  /**
   * Get all fired alerts.
   */
  getFiredAlerts(): Alert[] {
    return [...this.firedAlerts];
  }

  /**
   * Get all configured rules.
   */
  getRules(): AlertRule[] {
    return [...this.rules];
  }

  // -----------------------------------------------------------------------
  // Channel Implementations
  // -----------------------------------------------------------------------

  private async sendSlack(alert: Alert): Promise<void> {
    const config = this.channelConfig.slack;
    if (!config) {
      logger.debug("Slack not configured, skipping alert");
      return;
    }

    let severity = "[INFO]";
    if (alert.severity === "critical") {
      severity = "[CRITICAL]";
    } else if (alert.severity === "warning") {
      severity = "[WARNING]";
    }

    await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: config.channel,
        text: `${severity} ${alert.message}`,
      }),
      signal: AbortSignal.timeout(5000),
    });
  }

  private sendEmail(alert: Alert): void {
    const config = this.channelConfig.email;
    if (!config) {
      logger.debug("Email not configured, skipping alert");
      return;
    }

    // In production, integrate with email service (SendGrid, SES, etc.)
    logger.info(
      {
        to: config.to,
        subject: `Prometheus Alert: ${alert.rule.name}`,
        severity: alert.severity,
      },
      "Email alert dispatched"
    );
  }

  private async sendWebhook(alert: Alert): Promise<void> {
    const config = this.channelConfig.webhook;
    if (!config) {
      logger.debug("Webhook not configured, skipping alert");
      return;
    }

    await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
      body: JSON.stringify({
        alert: {
          ruleId: alert.rule.id,
          metric: alert.metric,
          value: alert.value,
          threshold: alert.rule.threshold,
          severity: alert.severity,
          message: alert.message,
          firedAt: alert.firedAt,
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
  }
}
