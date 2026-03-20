import { createLogger } from "@prometheus/logger";
import { inngest } from "./inngest";

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

interface WorkflowRecord {
  args: Record<string, unknown>;
  cancelledAt?: string;
  completedAt?: string;
  error?: string;
  result?: unknown;
  runId: string;
  startedAt: string;
  status: "running" | "completed" | "failed" | "cancelled" | "terminated";
  taskQueue: string;
  workflowId: string;
  workflowType: string;
}

/**
 * WorkflowClient provides an Inngest-backed interface for starting
 * and managing durable workflows.
 *
 * Workflows are triggered by sending Inngest events. The client maintains
 * an in-memory registry of active workflows for status queries and
 * cancellation support.
 */
export class WorkflowClient {
  private readonly namespace: string;
  private readonly workflows = new Map<string, WorkflowRecord>();

  constructor(options?: { namespace?: string }) {
    this.namespace = options?.namespace ?? "default";
    logger.info({ namespace: this.namespace }, "WorkflowClient initialized");
  }

  /**
   * Start a new workflow execution by sending an Inngest event.
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
    const taskQueue = options?.taskQueue ?? "default";

    logger.info(
      {
        workflowType,
        workflowId,
        runId,
        taskQueue,
        namespace: this.namespace,
        argKeys: Object.keys(args),
      },
      "Starting workflow via Inngest"
    );

    // Send the Inngest event to trigger the workflow function
    await inngest.send({
      name: workflowType,
      data: {
        ...args,
        _workflow: {
          workflowId,
          runId,
          taskQueue,
          namespace: this.namespace,
          retryPolicy: options?.retryPolicy,
        },
      },
    });

    // Track the workflow locally for status queries
    const record: WorkflowRecord = {
      workflowId,
      runId,
      workflowType,
      taskQueue,
      args,
      status: "running",
      startedAt: new Date().toISOString(),
    };
    this.workflows.set(workflowId, record);

    logger.info(
      { workflowId, runId },
      "Workflow started successfully via Inngest"
    );

    return { workflowId, runId };
  }

  /**
   * Get the current status of a workflow execution.
   */
  getWorkflowStatus(workflowId: string): WorkflowStatusResult {
    logger.debug(
      { workflowId, namespace: this.namespace },
      "Getting workflow status"
    );

    const record = this.workflows.get(workflowId);
    if (!record) {
      logger.warn({ workflowId }, "Workflow not found in local registry");
      return {
        workflowId,
        runId: "unknown",
        status: "completed",
        startedAt: new Date().toISOString(),
      };
    }

    return {
      workflowId: record.workflowId,
      runId: record.runId,
      status: record.status,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      result: record.result,
    };
  }

  /**
   * Send a signal to a running workflow by dispatching an Inngest event.
   */
  async signalWorkflow(
    workflowId: string,
    signalName: string,
    payload?: Record<string, unknown>
  ): Promise<void> {
    logger.info(
      { workflowId, signalName, namespace: this.namespace },
      "Signaling workflow via Inngest event"
    );

    await inngest.send({
      name: signalName,
      data: {
        ...(payload ?? {}),
        _workflowId: workflowId,
      },
    });

    logger.debug({ workflowId, signalName }, "Signal event sent via Inngest");
  }

  /**
   * Cancel a running workflow by sending a cancellation event.
   *
   * Inngest functions can define `cancelOn` triggers that match on
   * specific event data fields. This method sends a cancellation event
   * that the workflow function can listen for.
   */
  async cancelWorkflow(workflowId: string): Promise<void> {
    logger.info(
      { workflowId, namespace: this.namespace },
      "Cancelling workflow"
    );

    const record = this.workflows.get(workflowId);
    if (!record) {
      logger.warn({ workflowId }, "Workflow not found for cancellation");
      return;
    }

    // Send cancellation event — workflow functions should have cancelOn configured
    // to match on data fields like taskId or sessionId
    await inngest.send({
      name: `${record.workflowType}.cancelled`,
      data: {
        ...record.args,
        _workflowId: workflowId,
        reason: "Cancelled by WorkflowClient",
      },
    });

    record.status = "cancelled";
    record.cancelledAt = new Date().toISOString();

    logger.info({ workflowId }, "Workflow cancellation event sent");
  }

  /**
   * List all tracked workflows, optionally filtering by status.
   */
  listWorkflows(filter?: {
    status?: WorkflowStatusResult["status"];
    workflowType?: string;
    limit?: number;
  }): WorkflowStatusResult[] {
    logger.debug(
      { filter, namespace: this.namespace },
      "Listing tracked workflows"
    );

    let records = [...this.workflows.values()];

    if (filter?.status) {
      records = records.filter((r) => r.status === filter.status);
    }
    if (filter?.workflowType) {
      records = records.filter((r) => r.workflowType === filter.workflowType);
    }

    // Sort by start time descending (newest first)
    records.sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    if (filter?.limit) {
      records = records.slice(0, filter.limit);
    }

    return records.map((r) => ({
      workflowId: r.workflowId,
      runId: r.runId,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      result: r.result,
    }));
  }

  /**
   * Mark a workflow as completed. Called by workflow functions upon completion.
   */
  markCompleted(workflowId: string, result?: unknown, error?: string): void {
    const record = this.workflows.get(workflowId);
    if (!record) {
      return;
    }

    record.status = error ? "failed" : "completed";
    record.completedAt = new Date().toISOString();
    record.result = result;
    record.error = error;

    logger.info(
      { workflowId, status: record.status },
      "Workflow marked as completed"
    );
  }

  /**
   * Clean up completed or failed workflows older than the specified age.
   */
  pruneWorkflows(maxAgeMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;

    for (const [id, record] of this.workflows) {
      const startedAt = new Date(record.startedAt).getTime();
      if (
        startedAt < cutoff &&
        (record.status === "completed" ||
          record.status === "failed" ||
          record.status === "cancelled")
      ) {
        this.workflows.delete(id);
        pruned++;
      }
    }

    if (pruned > 0) {
      logger.info({ pruned }, "Pruned old workflow records");
    }

    return pruned;
  }
}
