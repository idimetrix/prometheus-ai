import type {
  PluginContext,
  PluginLifecycle,
  PluginManifest,
  PluginTool,
} from "../types";

// ---------------------------------------------------------------------------
// SDK Types
// ---------------------------------------------------------------------------

type HookEvent =
  | "beforeActivate"
  | "afterActivate"
  | "beforeDeactivate"
  | "afterDeactivate"
  | "onError"
  | "onToolCall"
  | "onConfigChange";

type HookHandler = (data: Record<string, unknown>) => void | Promise<void>;

interface AgentConfig {
  description: string;
  instructions: string;
  model?: string;
  name: string;
  tools?: string[];
}

interface ToolSchema {
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
  requiresAuth?: boolean;
}

// ---------------------------------------------------------------------------
// Plugin SDK
// ---------------------------------------------------------------------------

/**
 * SDK for building Prometheus plugins. Provides a fluent interface for
 * registering tools, agents, and event hooks.
 *
 * Usage:
 * ```ts
 * const sdk = new PluginSDK();
 * sdk.registerTool("my-tool", schema, handler);
 * sdk.registerHook("afterActivate", () => { ... });
 * const lifecycle = sdk.buildLifecycle();
 * ```
 */
export class PluginSDK {
  private readonly tools = new Map<
    string,
    {
      handler: PluginTool["handler"];
      schema: ToolSchema;
    }
  >();
  private readonly agents = new Map<string, AgentConfig>();
  private readonly hooks = new Map<HookEvent, HookHandler[]>();
  private context: PluginContext | null = null;

  /**
   * Register a tool that will be exposed through the MCP gateway.
   */
  registerTool(
    name: string,
    schema: Omit<ToolSchema, "name">,
    handler: PluginTool["handler"]
  ): this {
    this.tools.set(name, {
      schema: { ...schema, name },
      handler,
    });

    // If already activated, register immediately
    if (this.context?.registerTool) {
      this.context.registerTool({
        name,
        description: schema.description,
        inputSchema: schema.inputSchema,
        requiresAuth: schema.requiresAuth ?? false,
        handler,
      });
    }

    return this;
  }

  /**
   * Register a custom agent type.
   */
  registerAgent(name: string, config: Omit<AgentConfig, "name">): this {
    this.agents.set(name, { ...config, name });
    return this;
  }

  /**
   * Register an event hook.
   */
  registerHook(event: HookEvent, handler: HookHandler): this {
    const handlers = this.hooks.get(event) ?? [];
    handlers.push(handler);
    this.hooks.set(event, handlers);
    return this;
  }

  /**
   * Get the current execution context (available after activation).
   */
  getContext(): PluginContext | null {
    return this.context;
  }

  /**
   * Get all registered tool names.
   */
  getRegisteredTools(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get all registered agent configs.
   */
  getRegisteredAgents(): AgentConfig[] {
    return Array.from(this.agents.values());
  }

  /**
   * Build a PluginLifecycle object from the SDK registrations.
   * Use this to register the plugin with the PluginManager.
   */
  buildLifecycle(): PluginLifecycle {
    return {
      activate: async (ctx: PluginContext) => {
        this.context = ctx;

        // Fire beforeActivate hooks
        await this.fireHooks("beforeActivate", {});

        // Register all tools
        for (const [name, { schema, handler }] of this.tools) {
          ctx.registerTool?.({
            name,
            description: schema.description,
            inputSchema: schema.inputSchema,
            requiresAuth: schema.requiresAuth ?? false,
            handler,
          });
        }

        // Fire afterActivate hooks
        await this.fireHooks("afterActivate", {});
      },
      deactivate: async (ctx: PluginContext) => {
        await this.fireHooks("beforeDeactivate", {});

        // Unregister all tools
        for (const name of this.tools.keys()) {
          ctx.unregisterTool?.(name);
        }

        await this.fireHooks("afterDeactivate", {});
        this.context = null;
      },
      onConfigChange: async (config, ctx) => {
        this.context = ctx;
        await this.fireHooks("onConfigChange", config);
      },
      healthCheck: () => {
        return Promise.resolve(true);
      },
    };
  }

  /**
   * Build a complete plugin manifest + lifecycle pair.
   */
  build(manifest: PluginManifest): {
    lifecycle: PluginLifecycle;
    manifest: PluginManifest;
  } {
    return {
      manifest,
      lifecycle: this.buildLifecycle(),
    };
  }

  private async fireHooks(
    event: HookEvent,
    data: Record<string, unknown>
  ): Promise<void> {
    const handlers = this.hooks.get(event);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      try {
        await handler(data);
      } catch (error) {
        // Fire error hooks (but don't recurse)
        if (event !== "onError") {
          await this.fireHooks("onError", {
            error: error instanceof Error ? error.message : String(error),
            sourceEvent: event,
          });
        }
      }
    }
  }
}

export type { AgentConfig, HookEvent, HookHandler, ToolSchema };
