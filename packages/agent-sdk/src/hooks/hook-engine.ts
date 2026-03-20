import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("agent-sdk:hook-engine");

export type HookEvent =
  | "preToolUse"
  | "postToolUse"
  | "preIteration"
  | "postIteration"
  | "onError"
  | "onCheckpoint"
  | "onAgentSpawn"
  | "onAgentComplete"
  | "onConflict";

export interface HookContext {
  agentRole: string;
  confidence?: number;
  error?: Error;
  filesChanged?: string[];
  iteration?: number;
  sessionId: string;
  taskId: string;
  toolArgs?: Record<string, unknown>;
  toolName?: string;
  toolResult?: { success: boolean; output: string };
}

export type HookHandler = (ctx: HookContext) => Promise<HookResult>;

export interface HookResult {
  /** Whether to block the operation */
  blocked?: boolean;
  /** Reason for blocking */
  blockReason?: string;
  /** Optional modifications to inject into context */
  contextInjection?: string;
  /** Whether to proceed with the operation */
  proceed: boolean;
  /** Optional message to the user */
  userMessage?: string;
}

export interface HookRegistration {
  description: string;
  enabled: boolean;
  event: HookEvent;
  handler: HookHandler;
  id: string;
  priority: number;
}

export class HookEngine {
  private readonly hooks = new Map<HookEvent, HookRegistration[]>();

  register(
    event: HookEvent,
    handler: HookHandler,
    options?: { priority?: number; description?: string; id?: string }
  ): string {
    const id = options?.id ?? generateId();
    const registration: HookRegistration = {
      id,
      event,
      handler,
      priority: options?.priority ?? 100,
      description: options?.description ?? "",
      enabled: true,
    };

    const existing = this.hooks.get(event) ?? [];
    existing.push(registration);
    existing.sort((a, b) => a.priority - b.priority);
    this.hooks.set(event, existing);

    logger.debug(
      { id, event, priority: registration.priority },
      "Registered hook"
    );
    return id;
  }

  unregister(hookId: string): void {
    for (const [event, registrations] of this.hooks) {
      const idx = registrations.findIndex((r) => r.id === hookId);
      if (idx !== -1) {
        registrations.splice(idx, 1);
        logger.debug({ hookId, event }, "Unregistered hook");
        return;
      }
    }
    logger.warn({ hookId }, "Hook not found for unregister");
  }

  enable(hookId: string): void {
    const registration = this.findById(hookId);
    if (registration) {
      registration.enabled = true;
      logger.debug({ hookId }, "Enabled hook");
    } else {
      logger.warn({ hookId }, "Hook not found for enable");
    }
  }

  disable(hookId: string): void {
    const registration = this.findById(hookId);
    if (registration) {
      registration.enabled = false;
      logger.debug({ hookId }, "Disabled hook");
    } else {
      logger.warn({ hookId }, "Hook not found for disable");
    }
  }

  async execute(event: HookEvent, context: HookContext): Promise<HookResult> {
    const registrations = this.hooks.get(event) ?? [];
    const enabledHooks = registrations.filter((r) => r.enabled);

    if (enabledHooks.length === 0) {
      return { proceed: true };
    }

    logger.debug({ event, count: enabledHooks.length }, "Executing hooks");

    const contextInjections: string[] = [];
    let userMessage: string | undefined;

    for (const registration of enabledHooks) {
      try {
        const result = await registration.handler(context);

        if (result.contextInjection) {
          contextInjections.push(result.contextInjection);
        }

        if (result.userMessage) {
          userMessage = result.userMessage;
        }

        if (result.blocked) {
          logger.info(
            { hookId: registration.id, event, reason: result.blockReason },
            "Hook blocked execution"
          );
          return {
            proceed: false,
            blocked: true,
            blockReason: result.blockReason,
            contextInjection:
              contextInjections.length > 0
                ? contextInjections.join("\n")
                : undefined,
            userMessage,
          };
        }
      } catch (err) {
        logger.error(
          {
            hookId: registration.id,
            event,
            error: err instanceof Error ? err.message : String(err),
          },
          "Hook execution failed"
        );
      }
    }

    return {
      proceed: true,
      contextInjection:
        contextInjections.length > 0 ? contextInjections.join("\n") : undefined,
      userMessage,
    };
  }

  getRegistered(event?: HookEvent): HookRegistration[] {
    if (event) {
      return [...(this.hooks.get(event) ?? [])];
    }

    const all: HookRegistration[] = [];
    for (const registrations of this.hooks.values()) {
      all.push(...registrations);
    }
    return all;
  }

  private findById(hookId: string): HookRegistration | undefined {
    for (const registrations of this.hooks.values()) {
      const found = registrations.find((r) => r.id === hookId);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
}
