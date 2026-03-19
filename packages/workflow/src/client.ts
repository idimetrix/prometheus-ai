import { createLogger } from "@prometheus/logger";

const logger = createLogger("workflow:client");

export interface WorkflowHandle {
  runId: string;
  workflowId: string;
}

export interface WorkflowStatusResult {
  completedAt?: string;
  result?: unknown;
  runId: string;
  startedAt: string;
  status: "running" | "completed" | "failed" | "cancelled" | "terminated";
  workflowId: string;
}

/**
 * WorkflowClient provides a Temporal-compatible interface for starting
 * and managing durable workflows.
 *
 * TODO: Replace stub implementation with actual Temporal SDK integration
 * when @temporalio/client is added as a dependency.
 */
export class WorkflowClient {
  private readonly namespace: string;

  constructor(options?: { namespace?: string }) {
    this.namespace = options?.namespace ?? "default";
    logger.info(
      { namespace: this.namespace },
      "WorkflowClient initialized (stub mode)"
    );
  }

  /**
   * Start a new workflow execution.
   */
  async startWorkflow(
    workflowType: string,
    args: Record<string, unknown>,
    options?: {
      workflowId?: string;
      taskQueue?: string;
      retryPolicy?: { maximumAttempts: number };
    }
  ): Promise<WorkflowHandle> {
    const workflowId =
      options?.workflowId ??
      `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    logger.info(
      {
        workflowType,
        workflowId,
        runId,
        taskQueue: options?.taskQueue ?? "default",
        namespace: this.namespace,
        argKeys: Object.keys(args),
      },
      "Starting workflow (stub)"
    );

    // TODO: Replace with actual Temporal SDK call:
    // const handle = await this.client.workflow.start(workflowType, {
    //   args: [args],
    //   taskQueue: options?.taskQueue ?? 'default',
    //   workflowId,
    //   retry: options?.retryPolicy,
    // });

    await Promise.resolve();
    return { workflowId, runId };
  }

  /**
   * Get the current status of a workflow execution.
   */
  async getWorkflowStatus(workflowId: string): Promise<WorkflowStatusResult> {
    logger.info(
      { workflowId, namespace: this.namespace },
      "Getting workflow status (stub)"
    );

    // TODO: Replace with actual Temporal SDK call:
    // const handle = this.client.workflow.getHandle(workflowId);
    // const describe = await handle.describe();

    await Promise.resolve();
    return {
      workflowId,
      runId: "stub-run-id",
      status: "running",
      startedAt: new Date().toISOString(),
    };
  }

  /**
   * Send a signal to a running workflow.
   */
  async signalWorkflow(
    workflowId: string,
    signalName: string,
    payload?: Record<string, unknown>
  ): Promise<void> {
    logger.info(
      { workflowId, signalName, namespace: this.namespace },
      "Signaling workflow (stub)"
    );

    // TODO: Replace with actual Temporal SDK call:
    // const handle = this.client.workflow.getHandle(workflowId);
    // await handle.signal(signalName, payload);

    await Promise.resolve();
    logger.debug(
      { workflowId, signalName, payload },
      "Signal sent (stub - no-op)"
    );
  }

  /**
   * Cancel a running workflow.
   */
  async cancelWorkflow(workflowId: string): Promise<void> {
    logger.info(
      { workflowId, namespace: this.namespace },
      "Cancelling workflow (stub)"
    );

    // TODO: Replace with actual Temporal SDK call:
    // const handle = this.client.workflow.getHandle(workflowId);
    // await handle.cancel();

    await Promise.resolve();
    logger.debug({ workflowId }, "Workflow cancelled (stub - no-op)");
  }
}
