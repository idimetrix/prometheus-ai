import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:workflow:dispatcher");

/** Event that can be dispatched to a workflow engine */
export interface DispatchableEvent {
  data: Record<string, unknown>;
  name: string;
}

/** Supported workflow engines */
export type WorkflowEngine = "bullmq" | "inngest";

/** Result of a dispatch operation */
export interface DispatchResult {
  engine: WorkflowEngine;
  error?: string;
  eventName: string;
  success: boolean;
  workflowId?: string;
}

/**
 * WorkflowDispatcher routes workflow events to the configured
 * execution engine based on feature flags.
 *
 * Supports BullMQ (queue-based) and Inngest (durable function) engines.
 * The active engine is determined by the WORKFLOW_ENGINE environment
 * variable or can be configured programmatically.
 */
export class WorkflowDispatcher {
  private readonly engine: WorkflowEngine;
  private readonly bullmqDispatch?: (
    event: DispatchableEvent
  ) => Promise<string>;
  private readonly inngestDispatch?: (
    event: DispatchableEvent
  ) => Promise<string>;

  constructor(opts?: {
    engine?: WorkflowEngine;
    bullmqDispatch?: (event: DispatchableEvent) => Promise<string>;
    inngestDispatch?: (event: DispatchableEvent) => Promise<string>;
  }) {
    this.engine = opts?.engine ?? getWorkflowEngine();
    this.bullmqDispatch = opts?.bullmqDispatch;
    this.inngestDispatch = opts?.inngestDispatch;

    logger.info({ engine: this.engine }, "WorkflowDispatcher initialized");
  }

  /**
   * Dispatch an event to the configured workflow engine.
   */
  async dispatch(event: DispatchableEvent): Promise<DispatchResult> {
    logger.info(
      { engine: this.engine, eventName: event.name },
      "Dispatching workflow event"
    );

    try {
      let workflowId: string;

      switch (this.engine) {
        case "inngest": {
          if (!this.inngestDispatch) {
            throw new Error("Inngest dispatch handler not configured");
          }
          workflowId = await this.inngestDispatch(event);
          break;
        }
        case "bullmq": {
          if (!this.bullmqDispatch) {
            throw new Error("BullMQ dispatch handler not configured");
          }
          workflowId = await this.bullmqDispatch(event);
          break;
        }
        default: {
          throw new Error(`Unknown workflow engine: ${this.engine}`);
        }
      }

      logger.info(
        { engine: this.engine, eventName: event.name, workflowId },
        "Workflow event dispatched successfully"
      );

      return {
        engine: this.engine,
        eventName: event.name,
        success: true,
        workflowId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      logger.error(
        { error, engine: this.engine, eventName: event.name },
        "Failed to dispatch workflow event"
      );

      return {
        engine: this.engine,
        eventName: event.name,
        success: false,
        error: message,
      };
    }
  }

  /**
   * Get the current workflow engine.
   */
  getEngine(): WorkflowEngine {
    return this.engine;
  }
}

/**
 * Read the workflow engine from the WORKFLOW_ENGINE environment variable.
 * Defaults to "inngest" if not set.
 */
function getWorkflowEngine(): WorkflowEngine {
  const env = process.env.WORKFLOW_ENGINE?.toLowerCase();
  if (env === "bullmq") {
    return "bullmq";
  }
  return "inngest";
}
