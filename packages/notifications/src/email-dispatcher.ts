/**
 * Email Notification Dispatcher
 *
 * Dispatches email notifications for platform events via the Resend API.
 * Supports multiple event types with templated subjects and bodies.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("notifications:email");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationTrigger =
  | "task_completed"
  | "task_failed"
  | "pr_created"
  | "deployment_succeeded"
  | "deployment_failed"
  | "approval_required"
  | "sla_breach";

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EventPayload {
  data: Record<string, string>;
  trigger: NotificationTrigger;
}

export interface DispatchResult {
  error?: string;
  eventType: NotificationTrigger;
  messageId?: string;
  recipientCount: number;
  success: boolean;
}

interface EmailTemplate {
  body: string;
  subject: string;
}

interface RecipientPreference {
  eventTypes: NotificationTrigger[];
  orgId: string;
  recipients: EmailRecipient[];
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const TEMPLATES: Record<NotificationTrigger, EmailTemplate> = {
  task_completed: {
    subject: 'Task Completed: "{{taskTitle}}" in {{projectName}}',
    body: [
      "Hi {{recipientName}},",
      "",
      'The task "{{taskTitle}}" in project {{projectName}} has been completed successfully.',
      "",
      "Summary: {{summary}}",
      "",
      "View details: {{taskUrl}}",
      "",
      "- Prometheus Platform",
    ].join("\n"),
  },
  task_failed: {
    subject: 'Task Failed: "{{taskTitle}}" in {{projectName}}',
    body: [
      "Hi {{recipientName}},",
      "",
      'The task "{{taskTitle}}" in project {{projectName}} has failed.',
      "",
      "Error: {{errorMessage}}",
      "",
      "View details: {{taskUrl}}",
      "",
      "- Prometheus Platform",
    ].join("\n"),
  },
  pr_created: {
    subject: "New Pull Request: {{prTitle}} (#{{prNumber}})",
    body: [
      "Hi {{recipientName}},",
      "",
      "A new pull request has been created in {{projectName}}:",
      "",
      "Title: {{prTitle}}",
      "Branch: {{branch}}",
      "Author: {{author}}",
      "",
      "{{prDescription}}",
      "",
      "Review it here: {{prUrl}}",
      "",
      "- Prometheus Platform",
    ].join("\n"),
  },
  deployment_succeeded: {
    subject: "Deployment Succeeded: {{projectName}} to {{environment}}",
    body: [
      "Hi {{recipientName}},",
      "",
      "A deployment to {{environment}} has succeeded for {{projectName}}.",
      "",
      "Version: {{version}}",
      "Deployed at: {{deployedAt}}",
      "",
      "View deployment: {{deploymentUrl}}",
      "",
      "- Prometheus Platform",
    ].join("\n"),
  },
  deployment_failed: {
    subject: "Deployment Failed: {{projectName}} to {{environment}}",
    body: [
      "Hi {{recipientName}},",
      "",
      "A deployment to {{environment}} has FAILED for {{projectName}}.",
      "",
      "Version: {{version}}",
      "Error: {{errorMessage}}",
      "",
      "View details: {{deploymentUrl}}",
      "",
      "- Prometheus Platform",
    ].join("\n"),
  },
  approval_required: {
    subject: "Approval Required: {{title}}",
    body: [
      "Hi {{recipientName}},",
      "",
      "An action in {{projectName}} requires your approval:",
      "",
      "{{title}}",
      "{{description}}",
      "",
      "Requested by: {{requestedBy}}",
      "",
      "Approve or reject: {{approvalUrl}}",
      "",
      "- Prometheus Platform",
    ].join("\n"),
  },
  sla_breach: {
    subject: "SLA Breach Warning: {{projectName}}",
    body: [
      "Hi {{recipientName}},",
      "",
      "An SLA breach has been detected in {{projectName}}:",
      "",
      "Metric: {{metric}}",
      "Threshold: {{threshold}}",
      "Current Value: {{currentValue}}",
      "Breached at: {{breachedAt}}",
      "",
      "View details: {{dashboardUrl}}",
      "",
      "- Prometheus Platform",
    ].join("\n"),
  },
};

// ---------------------------------------------------------------------------
// Placeholder Interpolation
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    const value = vars[key];
    if (value !== undefined) {
      return value;
    }
    return match;
  });
}

// ---------------------------------------------------------------------------
// EmailDispatcher
// ---------------------------------------------------------------------------

const RESEND_API = "https://api.resend.com";

/**
 * Dispatches email notifications for platform events via Resend.
 */
export class EmailDispatcher {
  private readonly apiKey: string;
  private readonly fromAddress: string;
  private readonly recipientPreferences: RecipientPreference[] = [];

  constructor(options?: { apiKey?: string; fromAddress?: string }) {
    this.apiKey = options?.apiKey ?? process.env.RESEND_API_KEY ?? "";
    this.fromAddress = options?.fromAddress ?? "notifications@prometheus.dev";
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Register default recipients for an organization and set of event types.
   */
  registerRecipientPreferences(
    orgId: string,
    eventTypes: NotificationTrigger[],
    recipients: EmailRecipient[]
  ): void {
    this.recipientPreferences.push({ orgId, eventTypes, recipients });
    logger.info(
      { orgId, eventTypes, recipientCount: recipients.length },
      "Registered recipient preferences"
    );
  }

  /**
   * Get default recipients for an event type within an organization.
   * Returns all recipients that are subscribed to the given event type.
   */
  getDefaultRecipients(
    orgId: string,
    eventType: NotificationTrigger
  ): EmailRecipient[] {
    const recipients: EmailRecipient[] = [];
    for (const pref of this.recipientPreferences) {
      if (pref.orgId === orgId && pref.eventTypes.includes(eventType)) {
        for (const r of pref.recipients) {
          // Deduplicate by email
          if (!recipients.some((existing) => existing.email === r.email)) {
            recipients.push(r);
          }
        }
      }
    }
    return recipients;
  }

  /**
   * Dispatch an email notification for a platform event.
   * Selects the appropriate template, interpolates variables, and sends via Resend.
   */
  async dispatchEmailForEvent(
    event: EventPayload,
    recipients: EmailRecipient[]
  ): Promise<DispatchResult> {
    if (!this.isConfigured) {
      logger.debug(
        { trigger: event.trigger },
        "Email not configured, skipping dispatch"
      );
      return {
        eventType: event.trigger,
        recipientCount: recipients.length,
        success: false,
        error: "Email dispatcher not configured (missing RESEND_API_KEY)",
      };
    }

    if (recipients.length === 0) {
      logger.warn({ trigger: event.trigger }, "No recipients for event");
      return {
        eventType: event.trigger,
        recipientCount: 0,
        success: false,
        error: "No recipients specified",
      };
    }

    const template = TEMPLATES[event.trigger];
    if (!template) {
      logger.error({ trigger: event.trigger }, "Unknown event trigger");
      return {
        eventType: event.trigger,
        recipientCount: recipients.length,
        success: false,
        error: `Unknown event trigger: ${event.trigger}`,
      };
    }

    const toAddresses = recipients.map((r) =>
      r.name ? `${r.name} <${r.email}>` : r.email
    );

    // Use the first recipient name for personalization fallback
    const vars: Record<string, string> = {
      recipientName: recipients[0]?.name ?? "there",
      ...event.data,
    };

    const subject = interpolate(template.subject, vars);
    const body = interpolate(template.body, vars);

    try {
      const resp = await fetch(`${RESEND_API}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.fromAddress,
          to: toAddresses,
          subject,
          text: body,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => "unknown error");
        logger.error(
          { status: resp.status, trigger: event.trigger, error: errorText },
          "Resend API request failed"
        );
        return {
          eventType: event.trigger,
          recipientCount: recipients.length,
          success: false,
          error: `Resend API returned ${resp.status}: ${errorText}`,
        };
      }

      const data = (await resp.json()) as { id?: string };

      logger.info(
        {
          trigger: event.trigger,
          recipientCount: recipients.length,
          messageId: data.id,
        },
        "Email dispatched successfully"
      );

      return {
        eventType: event.trigger,
        recipientCount: recipients.length,
        success: true,
        messageId: data.id,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { error: msg, trigger: event.trigger },
        "Email dispatch error"
      );
      return {
        eventType: event.trigger,
        recipientCount: recipients.length,
        success: false,
        error: msg,
      };
    }
  }

  /**
   * Convenience method: dispatch to default recipients for an org.
   */
  async dispatchToDefaultRecipients(
    orgId: string,
    event: EventPayload
  ): Promise<DispatchResult> {
    const recipients = this.getDefaultRecipients(orgId, event.trigger);
    return await this.dispatchEmailForEvent(event, recipients);
  }

  /**
   * List all supported event triggers.
   */
  getSupportedTriggers(): NotificationTrigger[] {
    return Object.keys(TEMPLATES) as NotificationTrigger[];
  }
}

export function createEmailDispatcher(options?: {
  apiKey?: string;
  fromAddress?: string;
}): EmailDispatcher {
  return new EmailDispatcher(options);
}
