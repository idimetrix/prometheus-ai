/**
 * Microsoft Teams Bot Integration
 *
 * Sends notifications to Microsoft Teams channels via incoming webhooks.
 * Supports Adaptive Cards for rich interactive messages.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("notifications:teams");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamsConfig {
  defaultWebhookUrl?: string;
}

export interface AdaptiveCard {
  $schema?: string;
  actions?: AdaptiveCardAction[];
  body: AdaptiveCardElement[];
  type: "AdaptiveCard";
  version: string;
}

export interface AdaptiveCardElement {
  color?: string;
  columns?: Array<{
    type: string;
    width: string;
    items: AdaptiveCardElement[];
  }>;
  facts?: Array<{ title: string; value: string }>;
  items?: AdaptiveCardElement[];
  separator?: boolean;
  size?: string;
  spacing?: string;
  text?: string;
  type: string;
  weight?: string;
  wrap?: boolean;
}

export interface AdaptiveCardAction {
  data?: Record<string, unknown>;
  style?: string;
  title: string;
  type: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// TeamsBot
// ---------------------------------------------------------------------------

/**
 * Microsoft Teams bot adapter for Prometheus notifications.
 * Uses incoming webhook format to send Adaptive Cards and plain messages.
 */
function getTeamsStatusColor(status: string): string {
  if (status === "completed") {
    return "good";
  }
  if (status === "failed") {
    return "attention";
  }
  return "warning";
}

export class TeamsBot {
  /**
   * Send an Adaptive Card to a Teams channel via incoming webhook.
   */
  async sendAdaptiveCard(
    webhookUrl: string,
    card: AdaptiveCard
  ): Promise<boolean> {
    try {
      const payload = {
        type: "message",
        attachments: [
          {
            contentType: "application/vnd.microsoft.card.adaptive",
            contentUrl: null,
            content: {
              $schema:
                card.$schema ??
                "http://adaptivecards.io/schemas/adaptive-card.json",
              type: card.type,
              version: card.version,
              body: card.body,
              actions: card.actions,
            },
          },
        ],
      };

      const resp = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok) {
        logger.error({ status: resp.status }, "Teams webhook send failed");
        return false;
      }

      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, "Teams send error");
      return false;
    }
  }

  /**
   * Send a task status notification as an Adaptive Card.
   */
  async sendTaskNotification(
    webhookUrl: string,
    task: { title: string; status: string; projectName: string; url?: string }
  ): Promise<boolean> {
    const statusColor = getTeamsStatusColor(task.status);

    const card: AdaptiveCard = {
      type: "AdaptiveCard",
      version: "1.4",
      body: [
        {
          type: "TextBlock",
          text: `Task ${task.status}`,
          size: "large",
          weight: "bolder",
          color: statusColor,
        },
        {
          type: "TextBlock",
          text: task.title,
          size: "medium",
          weight: "bolder",
          wrap: true,
        },
        {
          type: "FactSet",
          facts: [
            { title: "Project", value: task.projectName },
            { title: "Status", value: task.status },
          ],
        },
      ],
      actions: task.url
        ? [{ type: "Action.OpenUrl", title: "View Task", url: task.url }]
        : [],
    };

    return await this.sendAdaptiveCard(webhookUrl, card);
  }

  /**
   * Send a pull request notification as an Adaptive Card.
   */
  async sendPRNotification(
    webhookUrl: string,
    pr: { title: string; url: string; projectName: string; action: string }
  ): Promise<boolean> {
    const card: AdaptiveCard = {
      type: "AdaptiveCard",
      version: "1.4",
      body: [
        {
          type: "TextBlock",
          text: `Pull Request ${pr.action}`,
          size: "large",
          weight: "bolder",
          color: "accent",
        },
        {
          type: "TextBlock",
          text: pr.title,
          size: "medium",
          weight: "bolder",
          wrap: true,
        },
        {
          type: "FactSet",
          facts: [
            { title: "Project", value: pr.projectName },
            { title: "Action", value: pr.action },
          ],
        },
      ],
      actions: [
        { type: "Action.OpenUrl", title: "View Pull Request", url: pr.url },
      ],
    };

    return await this.sendAdaptiveCard(webhookUrl, card);
  }

  /**
   * Send a deployment notification as an Adaptive Card.
   */
  async sendDeployNotification(
    webhookUrl: string,
    deploy: {
      environment: string;
      version: string;
      status: string;
      projectName: string;
    }
  ): Promise<boolean> {
    const statusColor = deploy.status === "succeeded" ? "good" : "attention";

    const card: AdaptiveCard = {
      type: "AdaptiveCard",
      version: "1.4",
      body: [
        {
          type: "TextBlock",
          text: `Deployment ${deploy.status}`,
          size: "large",
          weight: "bolder",
          color: statusColor,
        },
        {
          type: "TextBlock",
          text: deploy.projectName,
          size: "medium",
          weight: "bolder",
          wrap: true,
        },
        {
          type: "ColumnSet",
          columns: [
            {
              type: "Column",
              width: "stretch",
              items: [
                { type: "TextBlock", text: "Environment", weight: "bolder" },
                { type: "TextBlock", text: deploy.environment },
              ],
            },
            {
              type: "Column",
              width: "stretch",
              items: [
                { type: "TextBlock", text: "Version", weight: "bolder" },
                { type: "TextBlock", text: deploy.version },
              ],
            },
          ],
        },
      ],
    };

    return await this.sendAdaptiveCard(webhookUrl, card);
  }

  /**
   * Send an approval request with approve/reject action buttons.
   * The action buttons post data back to the specified callback URL.
   */
  async sendApprovalCard(
    webhookUrl: string,
    approval: {
      title: string;
      description: string;
      requestedBy: string;
      approvalId: string;
      callbackUrl: string;
    }
  ): Promise<boolean> {
    const card: AdaptiveCard = {
      type: "AdaptiveCard",
      version: "1.4",
      body: [
        {
          type: "TextBlock",
          text: "Approval Required",
          size: "large",
          weight: "bolder",
          color: "warning",
        },
        {
          type: "TextBlock",
          text: approval.title,
          size: "medium",
          weight: "bolder",
          wrap: true,
        },
        {
          type: "TextBlock",
          text: approval.description,
          wrap: true,
          spacing: "small",
        },
        {
          type: "FactSet",
          facts: [
            { title: "Requested By", value: approval.requestedBy },
            { title: "Approval ID", value: approval.approvalId },
          ],
        },
      ],
      actions: [
        {
          type: "Action.Http",
          title: "Approve",
          url: approval.callbackUrl,
          style: "positive",
          data: {
            approvalId: approval.approvalId,
            decision: "approved",
          },
        },
        {
          type: "Action.Http",
          title: "Reject",
          url: approval.callbackUrl,
          style: "destructive",
          data: {
            approvalId: approval.approvalId,
            decision: "rejected",
          },
        },
      ],
    };

    return await this.sendAdaptiveCard(webhookUrl, card);
  }
}

export function createTeamsBot(_config?: TeamsConfig): TeamsBot {
  return new TeamsBot();
}
