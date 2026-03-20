import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:dag-decomposer");

/** Output of the MCTS planner that feeds into DAG decomposition */
export interface PlanNode {
  children?: PlanNode[];
  description: string;
  estimatedTokens?: number;
  id: string;
  priority?: number;
  suggestedRole?: string;
  title: string;
}

/** A schedulable task with explicit dependencies for the execution engine */
export interface SchedulableTask {
  /** Which agent role should handle this task */
  agentRole: string;
  /** IDs of tasks that must complete before this one can start */
  dependencies: string[];
  /** Full description */
  description: string;
  /** Estimated token usage for this task */
  estimatedTokens: number;
  /** Unique task identifier */
  id: string;
  /** Execution priority (lower = higher priority) */
  priority: number;
  /** Human-readable title */
  title: string;
}

/**
 * DAG Decomposer converts MCTS planner output into a flat list of
 * schedulable tasks with explicit dependency edges.
 *
 * The planner produces a tree of PlanNodes; the decomposer:
 * 1. Flattens the tree into tasks
 * 2. Preserves parent-child relationships as dependency edges
 * 3. Validates the resulting DAG via topological sort
 * 4. Assigns priorities based on tree depth and explicit priority hints
 */
export class DAGDecomposer {
  /**
   * Decompose a tree of plan nodes into a flat, schedulable task list.
   */
  decompose(mctsOutput: PlanNode[]): SchedulableTask[] {
    const tasks: SchedulableTask[] = [];

    for (const node of mctsOutput) {
      this.flattenNode(node, [], tasks);
    }

    // Validate: ensure no circular dependencies via topological sort
    const isValid = this.validateTopologicalSort(tasks);
    if (!isValid) {
      logger.error(
        { taskCount: tasks.length },
        "DAG validation failed: circular dependency detected"
      );
      throw new Error("Circular dependency detected in task DAG");
    }

    logger.info({ taskCount: tasks.length }, "DAG decomposition complete");

    return tasks;
  }

  /**
   * Recursively flatten a PlanNode tree into SchedulableTask entries.
   */
  private flattenNode(
    node: PlanNode,
    parentIds: string[],
    tasks: SchedulableTask[]
  ): void {
    const taskId = node.id || generateId("task");

    const task: SchedulableTask = {
      id: taskId,
      title: node.title,
      description: node.description,
      agentRole: node.suggestedRole ?? "coder",
      dependencies: [...parentIds],
      estimatedTokens: node.estimatedTokens ?? 5000,
      priority: node.priority ?? parentIds.length,
    };

    tasks.push(task);

    if (node.children && node.children.length > 0) {
      for (const child of node.children) {
        this.flattenNode(child, [taskId], tasks);
      }
    }
  }

  /**
   * Validate that the task list forms a valid DAG using Kahn's algorithm.
   * Returns true if no circular dependencies exist.
   */
  private validateTopologicalSort(tasks: SchedulableTask[]): boolean {
    const taskIds = new Set(tasks.map((t) => t.id));
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const task of tasks) {
      inDegree.set(task.id, 0);
      adjacency.set(task.id, []);
    }

    for (const task of tasks) {
      for (const dep of task.dependencies) {
        if (!taskIds.has(dep)) {
          logger.warn(
            { taskId: task.id, missingDep: dep },
            "Task references unknown dependency, skipping edge"
          );
          continue;
        }
        const neighbors = adjacency.get(dep) ?? [];
        neighbors.push(task.id);
        adjacency.set(dep, neighbors);
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(id);
      }
    }

    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      visited++;

      for (const neighbor of adjacency.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    return visited === tasks.length;
  }
}
