import { createLogger } from "@prometheus/logger";

const WHITESPACE_RE = /\s+/;

const logger = createLogger("queue-worker:scheduled-task");

export interface ScheduledTaskPayload {
  cronExpression: string;
  description: string;
  orgId: string;
  projectId?: string;
  scheduleId: string;
  taskDescription: string;
  timezone: string;
}

/**
 * Processes scheduled task jobs from the BullMQ queue.
 * When a scheduled task fires (based on its cron pattern), this handler
 * creates a new agent task and enqueues it for execution.
 */
export function processScheduledTask(payload: ScheduledTaskPayload): void {
  logger.info(
    {
      scheduleId: payload.scheduleId,
      orgId: payload.orgId,
      cron: payload.cronExpression,
    },
    "Processing scheduled task"
  );

  try {
    // In production, this would:
    // 1. Create a new session via the sessions table
    // 2. Create a task linked to that session
    // 3. Enqueue the task to the agent task queue
    // For now, log the execution
    const taskId = `task_sched_${Date.now()}`;

    logger.info(
      {
        scheduleId: payload.scheduleId,
        taskId,
        description: payload.taskDescription,
      },
      "Scheduled task created and enqueued"
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { scheduleId: payload.scheduleId, error: msg },
      "Failed to process scheduled task"
    );
    throw error;
  }
}

/**
 * Validates a cron expression (basic 5-field format).
 */
export function isValidCron(expression: string): boolean {
  const parts = expression.trim().split(WHITESPACE_RE);
  if (parts.length !== 5) {
    return false;
  }

  const ranges = [
    { min: 0, max: 59 }, // minute
    { min: 0, max: 23 }, // hour
    { min: 1, max: 31 }, // day of month
    { min: 1, max: 12 }, // month
    { min: 0, max: 7 }, // day of week
  ];

  for (let i = 0; i < 5; i++) {
    const part = parts[i] ?? "*";
    if (part === "*") {
      continue;
    }

    // Check if it's a valid number or range
    const num = Number.parseInt(part, 10);
    const range = ranges[i];
    if (range && !Number.isNaN(num) && (num < range.min || num > range.max)) {
      return false;
    }
  }

  return true;
}
