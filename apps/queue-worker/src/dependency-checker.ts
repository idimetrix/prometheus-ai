import { db, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { inArray } from "drizzle-orm";

const logger = createLogger("queue-worker:dependency-checker");

/**
 * Check whether all dependency tasks have completed successfully.
 * Returns true if all dependencies are in "completed" status.
 */
export async function checkDependencies(
  taskId: string,
  dependsOn: string[]
): Promise<boolean> {
  if (dependsOn.length === 0) {
    return true;
  }

  try {
    const depTasks = await db.query.tasks.findMany({
      where: inArray(tasks.id, dependsOn),
      columns: { id: true, status: true },
    });

    const completedIds = new Set(
      depTasks.filter((t) => t.status === "completed").map((t) => t.id)
    );

    const allCompleted = dependsOn.every((id) => completedIds.has(id));

    if (!allCompleted) {
      const pending = dependsOn.filter((id) => !completedIds.has(id));
      const failed = depTasks
        .filter(
          (t) =>
            (t.status === "failed" || t.status === "cancelled") &&
            dependsOn.includes(t.id)
        )
        .map((t) => t.id);

      logger.info(
        { taskId, pending, failed, total: dependsOn.length },
        "Task dependencies not yet satisfied"
      );

      // If any dependency has permanently failed, this task can never run
      if (failed.length > 0) {
        logger.warn(
          { taskId, failedDeps: failed },
          "Task has failed dependencies — cannot proceed"
        );
      }
    }

    return allCompleted;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { taskId, dependsOn, error: msg },
      "Failed to check task dependencies"
    );
    return false;
  }
}

/**
 * Check if any dependency has permanently failed (failed or cancelled).
 * Returns the IDs of failed dependencies if any exist.
 */
export async function getFailedDependencies(
  dependsOn: string[]
): Promise<string[]> {
  if (dependsOn.length === 0) {
    return [];
  }

  try {
    const depTasks = await db.query.tasks.findMany({
      where: inArray(tasks.id, dependsOn),
      columns: { id: true, status: true },
    });

    return depTasks
      .filter((t) => t.status === "failed" || t.status === "cancelled")
      .map((t) => t.id);
  } catch {
    return [];
  }
}
