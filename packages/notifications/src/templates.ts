import { createLogger } from "@prometheus/logger";

const logger = createLogger("notifications:templates");

// ---------------------------------------------------------------------------
// Template Types
// ---------------------------------------------------------------------------

export interface NotificationTemplate {
  /** Action URL template with {{variable}} placeholders */
  action: string;
  /** Default body with {{variable}} placeholders */
  body: string;
  /** Icon identifier for the UI */
  icon: string;
  /** Default title with {{variable}} placeholders */
  title: string;
}

export interface RenderedNotification {
  body: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Template Definitions
// ---------------------------------------------------------------------------

export const TASK_COMPLETE: NotificationTemplate = {
  title: "Task Completed",
  body: 'Task "{{taskTitle}}" has been completed successfully in project {{projectName}}.',
  icon: "check-circle",
  action: "/projects/{{projectId}}/tasks/{{taskId}}",
} as const;

export const TASK_FAILED: NotificationTemplate = {
  title: "Task Failed",
  body: 'Task "{{taskTitle}}" failed in project {{projectName}}. Reason: {{reason}}',
  icon: "x-circle",
  action: "/projects/{{projectId}}/tasks/{{taskId}}",
} as const;

export const CREDIT_LOW: NotificationTemplate = {
  title: "Credits Running Low",
  body: "Your organization {{orgName}} has {{remainingCredits}} credits remaining. Consider upgrading your plan to avoid interruptions.",
  icon: "alert-triangle",
  action: "/settings/billing",
} as const;

export const REVIEW_NEEDED: NotificationTemplate = {
  title: "Review Needed",
  body: "PR #{{prNumber}} in {{projectName}} is ready for your review. {{summary}}",
  icon: "git-pull-request",
  action: "/projects/{{projectId}}/prs/{{prNumber}}",
} as const;

export const DEPLOYMENT_READY: NotificationTemplate = {
  title: "Deployment Ready",
  body: "A new deployment for {{projectName}} ({{environment}}) is ready. Commit: {{commitSha}}",
  icon: "rocket",
  action: "/projects/{{projectId}}/deployments/{{deploymentId}}",
} as const;

// ---------------------------------------------------------------------------
// Template Registry
// ---------------------------------------------------------------------------

const TEMPLATE_REGISTRY: Record<string, NotificationTemplate> = {
  TASK_COMPLETE,
  TASK_FAILED,
  CREDIT_LOW,
  REVIEW_NEEDED,
  DEPLOYMENT_READY,
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

/**
 * Replace `{{key}}` placeholders in a template string with values from vars.
 * Unknown placeholders are left as-is.
 */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    const value = vars[key];
    if (value !== undefined) {
      return value;
    }
    logger.warn({ key, template }, "Missing template variable");
    return match;
  });
}

/**
 * Render a notification template by ID with the given variables.
 *
 * @param templateId - One of: TASK_COMPLETE, TASK_FAILED, CREDIT_LOW, REVIEW_NEEDED, DEPLOYMENT_READY
 * @param vars - Key-value map of placeholder replacements
 * @returns Rendered title and body strings
 *
 * @throws Error if templateId is unknown
 */
export function renderTemplate(
  templateId: string,
  vars: Record<string, string>
): RenderedNotification {
  const template = TEMPLATE_REGISTRY[templateId];
  if (!template) {
    const available = Object.keys(TEMPLATE_REGISTRY).join(", ");
    throw new Error(
      `Unknown notification template "${templateId}". Available: ${available}`
    );
  }

  return {
    title: interpolate(template.title, vars),
    body: interpolate(template.body, vars),
  };
}

/**
 * Render a notification template and also resolve the action URL.
 */
export function renderTemplateWithAction(
  templateId: string,
  vars: Record<string, string>
): RenderedNotification & { action: string; icon: string } {
  const template = TEMPLATE_REGISTRY[templateId];
  if (!template) {
    const available = Object.keys(TEMPLATE_REGISTRY).join(", ");
    throw new Error(
      `Unknown notification template "${templateId}". Available: ${available}`
    );
  }

  return {
    title: interpolate(template.title, vars),
    body: interpolate(template.body, vars),
    action: interpolate(template.action, vars),
    icon: template.icon,
  };
}

/**
 * List all available template IDs.
 */
export function getAvailableTemplates(): string[] {
  return Object.keys(TEMPLATE_REGISTRY);
}
