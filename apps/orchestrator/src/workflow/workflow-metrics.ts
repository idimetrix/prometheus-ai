import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:workflow:metrics");

/** Metric types tracked by the workflow engine */
interface WorkflowMetricCounters {
  cancellationsTotal: number;
  retriesTotal: number;
  workflowsCompleted: number;
  workflowsFailed: number;
  workflowsStarted: number;
}

/** Phase duration histogram entries */
interface PhaseDurationEntry {
  durationMs: number;
  phase: string;
  timestamp: number;
}

/** Workflow duration entry */
interface WorkflowDurationEntry {
  durationMs: number;
  success: boolean;
  timestamp: number;
  workflowId: string;
}

/**
 * WorkflowMetrics tracks Prometheus-style metrics for the workflow engine.
 *
 * Metrics tracked:
 * - workflows_started: Counter of workflows started
 * - workflows_completed: Counter of workflows completed (success/failure)
 * - workflow_duration_seconds: Histogram of workflow durations by phase
 * - retries_total: Counter of retry attempts
 * - cancellations_total: Counter of workflow cancellations
 */
export class WorkflowMetrics {
  private readonly counters: WorkflowMetricCounters = {
    workflowsStarted: 0,
    workflowsCompleted: 0,
    workflowsFailed: 0,
    retriesTotal: 0,
    cancellationsTotal: 0,
  };

  private readonly phaseDurations: PhaseDurationEntry[] = [];
  private readonly workflowDurations: WorkflowDurationEntry[] = [];
  private readonly activeWorkflows = new Map<string, number>();

  /** Max entries to keep in duration arrays */
  private readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = maxEntries;
  }

  /**
   * Record that a workflow has started.
   */
  recordWorkflowStart(workflowId: string): void {
    this.counters.workflowsStarted++;
    this.activeWorkflows.set(workflowId, Date.now());

    logger.debug({ workflowId }, "Workflow started metric recorded");
  }

  /**
   * Record that a workflow has completed.
   */
  recordWorkflowComplete(workflowId: string, success: boolean): void {
    if (success) {
      this.counters.workflowsCompleted++;
    } else {
      this.counters.workflowsFailed++;
    }

    const startTime = this.activeWorkflows.get(workflowId);
    if (startTime) {
      const durationMs = Date.now() - startTime;
      this.workflowDurations.push({
        workflowId,
        durationMs,
        success,
        timestamp: Date.now(),
      });

      // Trim old entries
      if (this.workflowDurations.length > this.maxEntries) {
        this.workflowDurations.splice(
          0,
          this.workflowDurations.length - this.maxEntries
        );
      }

      this.activeWorkflows.delete(workflowId);
    }

    logger.debug({ workflowId, success }, "Workflow complete metric recorded");
  }

  /**
   * Record that a phase has completed with its duration.
   */
  recordPhaseComplete(phase: string, durationMs: number): void {
    this.phaseDurations.push({
      phase,
      durationMs,
      timestamp: Date.now(),
    });

    // Trim old entries
    if (this.phaseDurations.length > this.maxEntries) {
      this.phaseDurations.splice(
        0,
        this.phaseDurations.length - this.maxEntries
      );
    }

    logger.debug({ phase, durationMs }, "Phase complete metric recorded");
  }

  /**
   * Record a retry attempt.
   */
  recordRetry(workflowId: string, stepName: string, attempt: number): void {
    this.counters.retriesTotal++;
    logger.debug({ workflowId, stepName, attempt }, "Retry metric recorded");
  }

  /**
   * Record a workflow cancellation.
   */
  recordCancellation(workflowId: string): void {
    this.counters.cancellationsTotal++;
    this.activeWorkflows.delete(workflowId);
    logger.debug({ workflowId }, "Cancellation metric recorded");
  }

  /**
   * Get current counter values.
   */
  getCounters(): WorkflowMetricCounters {
    return { ...this.counters };
  }

  /**
   * Get average phase duration in ms for a specific phase.
   */
  getAveragePhaseDuration(phase: string): number | null {
    const entries = this.phaseDurations.filter((e) => e.phase === phase);
    if (entries.length === 0) {
      return null;
    }

    const sum = entries.reduce((acc, e) => acc + e.durationMs, 0);
    return sum / entries.length;
  }

  /**
   * Get the number of currently active workflows.
   */
  getActiveWorkflowCount(): number {
    return this.activeWorkflows.size;
  }

  /**
   * Export all metrics in a Prometheus-compatible text format.
   */
  toPrometheusFormat(): string {
    const lines: string[] = [];

    lines.push("# HELP workflows_started Total workflows started");
    lines.push("# TYPE workflows_started counter");
    lines.push(`workflows_started ${this.counters.workflowsStarted}`);

    lines.push(
      "# HELP workflows_completed Total workflows completed successfully"
    );
    lines.push("# TYPE workflows_completed counter");
    lines.push(`workflows_completed ${this.counters.workflowsCompleted}`);

    lines.push("# HELP workflows_failed Total workflows that failed");
    lines.push("# TYPE workflows_failed counter");
    lines.push(`workflows_failed ${this.counters.workflowsFailed}`);

    lines.push("# HELP retries_total Total retry attempts");
    lines.push("# TYPE retries_total counter");
    lines.push(`retries_total ${this.counters.retriesTotal}`);

    lines.push("# HELP cancellations_total Total workflow cancellations");
    lines.push("# TYPE cancellations_total counter");
    lines.push(`cancellations_total ${this.counters.cancellationsTotal}`);

    lines.push("# HELP active_workflows Currently running workflows");
    lines.push("# TYPE active_workflows gauge");
    lines.push(`active_workflows ${this.activeWorkflows.size}`);

    // Phase duration averages
    const phases = new Set(this.phaseDurations.map((e) => e.phase));
    if (phases.size > 0) {
      lines.push(
        "# HELP workflow_phase_duration_seconds Average phase duration"
      );
      lines.push("# TYPE workflow_phase_duration_seconds gauge");
      for (const phase of phases) {
        const avg = this.getAveragePhaseDuration(phase);
        if (avg !== null) {
          lines.push(
            `workflow_phase_duration_seconds{phase="${phase}"} ${(avg / 1000).toFixed(3)}`
          );
        }
      }
    }

    return lines.join("\n");
  }
}
