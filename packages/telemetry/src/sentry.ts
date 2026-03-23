import type { Span } from "@sentry/node";
import {
  flush,
  httpIntegration,
  init,
  addBreadcrumb as sentryAddBreadcrumb,
  captureException as sentryCaptureException,
  captureMessage as sentryCaptureMessage,
  setUser as sentrySetUser,
  startSpan,
} from "@sentry/node";

export interface SentryConfig {
  dsn?: string;
  environment?: string;
  release?: string;
  sampleRate?: number;
  serviceName: string;
  tracesSampleRate?: number;
}

let sentryInitialized = false;

export function initSentry(config: SentryConfig): void {
  if (sentryInitialized) {
    return;
  }

  const dsn = config.dsn ?? process.env.SENTRY_DSN;
  if (!dsn) {
    return;
  }

  sentryInitialized = true;

  init({
    dsn,
    environment: config.environment ?? process.env.NODE_ENV ?? "development",
    release: config.release ?? process.env.APP_VERSION ?? "0.1.0",
    sampleRate: config.sampleRate ?? 1.0,
    tracesSampleRate:
      config.tracesSampleRate ??
      (process.env.NODE_ENV === "production" ? 0.1 : 1.0),
    serverName: config.serviceName,
    integrations: [httpIntegration()],
  });
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>
): string | undefined {
  if (!sentryInitialized) {
    return undefined;
  }
  return sentryCaptureException(error, { extra: context });
}

export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info"
): string | undefined {
  if (!sentryInitialized) {
    return undefined;
  }
  return sentryCaptureMessage(message, level);
}

export function setUser(user: {
  id: string;
  email?: string;
  orgId?: string;
}): void {
  if (!sentryInitialized) {
    return;
  }
  sentrySetUser({
    id: user.id,
    email: user.email,
    segment: user.orgId,
  });
}

export function addBreadcrumb(breadcrumb: {
  category: string;
  message: string;
  level?: "debug" | "info" | "warning" | "error";
  data?: Record<string, unknown>;
}): void {
  if (!sentryInitialized) {
    return;
  }
  sentryAddBreadcrumb({
    category: breadcrumb.category,
    message: breadcrumb.message,
    level: breadcrumb.level ?? "info",
    data: breadcrumb.data,
  });
}

export async function flushSentry(timeout = 2000): Promise<boolean> {
  if (!sentryInitialized) {
    return true;
  }
  return await flush(timeout);
}

// ---------------------------------------------------------------------------
// AI Agent Tracing
// ---------------------------------------------------------------------------

export function startAgentSpan(
  agentRole: string,
  sessionId: string,
  taskId: string
): Span | undefined {
  if (!sentryInitialized) {
    return undefined;
  }

  return startSpan(
    {
      name: `agent.${agentRole}`,
      op: "agent.execute",
      attributes: {
        "agent.role": agentRole,
        "session.id": sessionId,
        "task.id": taskId,
      },
    },
    (span) => span
  );
}

export function startToolSpan(
  toolName: string,
  _parentSpan?: Span
): Span | undefined {
  if (!sentryInitialized) {
    return undefined;
  }

  return startSpan(
    {
      name: `tool.${toolName}`,
      op: "tool.call",
      attributes: {
        "tool.name": toolName,
      },
    },
    (span) => span
  );
}

export function recordTokenUsage(
  span: Span | undefined,
  inputTokens: number,
  outputTokens: number
): void {
  if (!span) {
    return;
  }
  span.setAttribute("ai.input_tokens", inputTokens);
  span.setAttribute("ai.output_tokens", outputTokens);
  span.setAttribute("ai.total_tokens", inputTokens + outputTokens);
}

export function recordAgentIteration(
  span: Span | undefined,
  iteration: number,
  confidence: number
): void {
  if (!span) {
    return;
  }
  span.setAttribute("agent.iteration", iteration);
  span.setAttribute("agent.confidence", confidence);
}
