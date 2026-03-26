/**
 * Hook executor — runs project hooks before/after tool execution.
 *
 * Hooks are loaded from the database for a given project and event,
 * executed in priority order (highest first). Supports four action types:
 * - "block": prevents the tool from executing
 * - "transform": modifies tool input (via config.command evaluated as transform expression)
 * - "run_command": executes a shell command in the sandbox
 * - "call_webhook": POSTs event data to a webhook URL
 */

import type { HookAction, HookConfig, HookEvent } from "@prometheus/db";
import { db, projectHooks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, desc, eq } from "drizzle-orm";

const logger = createLogger("hook-executor");

/** Contextual data passed to hooks for evaluation. */
export interface HookContext {
  /** Tool arguments (if applicable) */
  args?: Record<string, unknown>;
  /** Error message (for on_error hooks) */
  error?: string;
  /** File path involved (if applicable) */
  filePath?: string;
  /** The org that owns this project */
  orgId: string;
  /** The project these hooks belong to */
  projectId: string;
  /** Optional sandbox ID for run_command hooks */
  sandboxId?: string;
  /** URL of sandbox manager for executing commands */
  sandboxManagerUrl?: string;
  /** ID of the current session */
  sessionId: string;
  /** The tool being called (if applicable) */
  toolName?: string;
}

export interface HookResult {
  /** Whether the tool should be blocked */
  blocked: boolean;
  /** Message explaining the block */
  blockMessage?: string;
  /** Errors from hook execution (non-fatal) */
  errors: string[];
  /** Modified args after transform hooks */
  transformedArgs?: Record<string, unknown>;
}

interface HookRow {
  action: string;
  config: HookConfig;
  event: string;
  id: string;
  name: string;
  priority: number;
}

/**
 * Execute all hooks for a given event on a project.
 * Hooks run in priority order (highest first).
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: hook execution requires sequential processing with multiple control flow paths
export async function executeHooks(
  event: HookEvent,
  context: HookContext
): Promise<HookResult> {
  const result: HookResult = {
    blocked: false,
    errors: [],
  };

  try {
    const hooks = await loadHooksForEvent(context.projectId, event);
    if (hooks.length === 0) {
      return result;
    }

    logger.info(
      { event, projectId: context.projectId, hookCount: hooks.length },
      "Executing hooks"
    );

    let currentArgs = context.args ? { ...context.args } : undefined;

    for (const hook of hooks) {
      // Check glob pattern filter
      if (
        hook.config.pattern &&
        context.filePath &&
        !matchGlobPattern(hook.config.pattern, context.filePath)
      ) {
        continue;
      }

      // Check if hook is enabled via config
      if (!hook.config.enabled) {
        continue;
      }

      try {
        const hookResult = await executeSingleHook(hook, context, currentArgs);

        if (hookResult.blocked) {
          result.blocked = true;
          result.blockMessage =
            hookResult.blockMessage ?? `Blocked by hook: ${hook.name}`;
          // Once blocked, stop processing further hooks
          break;
        }

        if (hookResult.transformedArgs) {
          currentArgs = hookResult.transformedArgs;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(
          { hookId: hook.id, hookName: hook.name, error: msg },
          "Hook execution failed"
        );
        result.errors.push(`Hook "${hook.name}" failed: ${msg}`);
      }
    }

    if (currentArgs && !result.blocked) {
      result.transformedArgs = currentArgs;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { event, projectId: context.projectId, error: msg },
      "Failed to load hooks"
    );
    result.errors.push(`Hook loading failed: ${msg}`);
  }

  return result;
}

/**
 * Load all hooks for a specific project and event, ordered by priority descending.
 */
async function loadHooksForEvent(
  projectId: string,
  event: HookEvent
): Promise<HookRow[]> {
  const rows = await db.query.projectHooks.findMany({
    where: and(
      eq(projectHooks.projectId, projectId),
      eq(projectHooks.event, event)
    ),
    orderBy: [desc(projectHooks.priority)],
  });

  return rows as unknown as HookRow[];
}

/**
 * Execute a single hook based on its action type.
 */
async function executeSingleHook(
  hook: HookRow,
  context: HookContext,
  currentArgs?: Record<string, unknown>
): Promise<{
  blocked: boolean;
  blockMessage?: string;
  transformedArgs?: Record<string, unknown>;
}> {
  const action = hook.action as HookAction;

  switch (action) {
    case "block":
      return {
        blocked: true,
        blockMessage:
          hook.config.command ?? `Action blocked by hook: ${hook.name}`,
      };

    case "transform":
      return executeTransformHook(hook, currentArgs);

    case "run_command":
      await executeRunCommandHook(hook, context);
      return { blocked: false };

    case "call_webhook":
      await executeWebhookHook(hook, context);
      return { blocked: false };

    default:
      logger.warn({ action: hook.action }, "Unknown hook action type");
      return { blocked: false };
  }
}

/**
 * Transform hook: applies a JSON-patch-style transform to tool arguments.
 * The config.command is a JSON string mapping arg keys to new values.
 */
function executeTransformHook(
  hook: HookRow,
  currentArgs?: Record<string, unknown>
): { blocked: false; transformedArgs?: Record<string, unknown> } {
  if (!(hook.config.command && currentArgs)) {
    return { blocked: false };
  }

  try {
    const transforms = JSON.parse(hook.config.command) as Record<
      string,
      unknown
    >;
    const newArgs = { ...currentArgs, ...transforms };
    return { blocked: false, transformedArgs: newArgs };
  } catch {
    logger.warn(
      { hookId: hook.id },
      "Transform hook has invalid JSON command, skipping"
    );
    return { blocked: false };
  }
}

/**
 * Run a shell command in the sandbox. Fire-and-forget style — we log but don't block.
 */
async function executeRunCommandHook(
  hook: HookRow,
  context: HookContext
): Promise<void> {
  const command = hook.config.command;
  if (!command) {
    logger.warn({ hookId: hook.id }, "run_command hook has no command");
    return;
  }

  const sandboxUrl = context.sandboxManagerUrl ?? "http://localhost:4006";
  const sandboxId = context.sandboxId ?? context.sessionId;

  try {
    const response = await fetch(
      `${sandboxUrl}/api/sandboxes/${sandboxId}/exec`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, timeout: 30_000 }),
      }
    );

    if (!response.ok) {
      logger.warn(
        { hookId: hook.id, status: response.status },
        "run_command hook returned non-OK status"
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { hookId: hook.id, error: msg },
      "run_command hook failed to reach sandbox"
    );
    throw new Error(`run_command failed: ${msg}`);
  }
}

/**
 * POST event data to a webhook URL.
 */
async function executeWebhookHook(
  hook: HookRow,
  context: HookContext
): Promise<void> {
  const webhookUrl = hook.config.webhookUrl;
  if (!webhookUrl) {
    logger.warn({ hookId: hook.id }, "call_webhook hook has no webhookUrl");
    return;
  }

  const payload = {
    event: hook.event,
    hookName: hook.name,
    projectId: context.projectId,
    sessionId: context.sessionId,
    toolName: context.toolName,
    filePath: context.filePath,
    args: context.args,
    error: context.error,
    timestamp: new Date().toISOString(),
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logger.warn(
        { hookId: hook.id, status: response.status },
        "Webhook returned non-OK status"
      );
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ hookId: hook.id, error: msg }, "Webhook call failed");
    throw new Error(`Webhook failed: ${msg}`);
  }
}

/**
 * Simple glob pattern matching. Supports * and ** wildcards.
 */
function matchGlobPattern(pattern: string, filePath: string): boolean {
  const regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "DOUBLE_STAR")
    .replace(/\*/g, "[^/]*")
    .replace(/DOUBLE_STAR/g, ".*");

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(filePath);
}
