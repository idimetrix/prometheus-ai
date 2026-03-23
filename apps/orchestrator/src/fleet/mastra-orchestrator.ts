import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:mastra");

export interface WorkflowTask {
  dependencies: string[];
  id: string;
  priority: number;
  role: string;
  title: string;
}

export interface WorkflowNode {
  agentId?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  taskId: string;
}

export interface WorkflowEdge {
  from: string;
  to: string;
  type: "depends_on" | "blocks";
}

export interface WorkflowGraph {
  edges: WorkflowEdge[];
  id: string;
  nodes: WorkflowNode[];
}

export interface WorkflowEvent {
  data?: Record<string, unknown>;
  taskId?: string;
  timestamp: string;
  type:
    | "workflow_started"
    | "task_started"
    | "task_completed"
    | "task_failed"
    | "workflow_completed"
    | "workflow_failed";
  workflowId: string;
}

export type WorkflowStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

interface WorkflowState {
  completedAt: Date | null;
  graph: WorkflowGraph;
  startedAt: Date | null;
  status: WorkflowStatus;
}

/**
 * MastraOrchestrator provides graph-based fleet workflow management.
 * It wraps task execution with workflow graph concepts, topological sort,
 * and dependency-aware execution ordering.
 */
export class MastraOrchestrator {
  private readonly workflows = new Map<string, WorkflowState>();

  /**
   * Create a workflow graph from a set of tasks.
   * Builds nodes and dependency edges, then validates the graph.
   */
  createWorkflow(tasks: WorkflowTask[]): WorkflowGraph {
    const id = generateId("wf");

    const nodes: WorkflowNode[] = tasks.map((task) => ({
      taskId: task.id,
      status: "pending",
    }));

    const edges: WorkflowEdge[] = [];
    const taskIds = new Set(tasks.map((t) => t.id));

    for (const task of tasks) {
      for (const dep of task.dependencies) {
        if (taskIds.has(dep)) {
          edges.push({
            from: dep,
            to: task.id,
            type: "depends_on",
          });
        } else {
          logger.warn(
            { taskId: task.id, dependency: dep },
            "Dependency not found in task set, ignoring"
          );
        }
      }
    }

    const graph: WorkflowGraph = { id, nodes, edges };

    // Validate no cycles
    const sorted = this.topologicalSort(tasks);
    if (sorted.length !== tasks.length) {
      logger.error(
        { workflowId: id, taskCount: tasks.length, sortedCount: sorted.length },
        "Circular dependency detected in workflow graph"
      );
    }

    this.workflows.set(id, {
      graph,
      status: "pending",
      startedAt: null,
      completedAt: null,
    });

    logger.info(
      { workflowId: id, taskCount: tasks.length, edgeCount: edges.length },
      "Workflow created"
    );

    return graph;
  }

  /**
   * Execute a workflow graph, yielding events as tasks progress.
   * Tasks only start when all their dependencies have completed.
   */
  async *executeWorkflow(
    graph: WorkflowGraph,
    sessionId: string
  ): AsyncGenerator<WorkflowEvent> {
    const state = this.workflows.get(graph.id);
    if (state) {
      state.status = "running";
      state.startedAt = new Date();
    }

    yield {
      type: "workflow_started",
      workflowId: graph.id,
      timestamp: new Date().toISOString(),
      data: { sessionId, taskCount: graph.nodes.length },
    };

    // Collect tasks for sorting
    const tasks: WorkflowTask[] = graph.nodes.map((node) => {
      const incomingEdges = graph.edges.filter(
        (e) => e.to === node.taskId && e.type === "depends_on"
      );
      return {
        id: node.taskId,
        role: "",
        title: "",
        dependencies: incomingEdges.map((e) => e.from),
        priority: 0,
      };
    });

    const executionOrder = this.topologicalSort(tasks);
    const completed = new Set<string>();
    const nodeMap = new Map(graph.nodes.map((n) => [n.taskId, n]));
    let hasFailure = false;

    // Execute in waves based on dependency satisfaction
    while (completed.size < executionOrder.length && !hasFailure) {
      await Promise.resolve(); // Yield to event loop between waves
      const ready = executionOrder.filter((taskId) => {
        if (completed.has(taskId)) {
          return false;
        }
        const deps = graph.edges
          .filter((e) => e.to === taskId && e.type === "depends_on")
          .map((e) => e.from);
        return deps.every((d) => completed.has(d));
      });

      if (ready.length === 0 && completed.size < executionOrder.length) {
        logger.error(
          { workflowId: graph.id },
          "Deadlock detected: no tasks ready but workflow incomplete"
        );
        hasFailure = true;
        break;
      }

      // Execute ready tasks (in parallel conceptually, sequential for generator)
      for (const taskId of ready) {
        const node = nodeMap.get(taskId);
        if (!node) {
          continue;
        }

        node.status = "running";
        node.agentId = generateId("agent");

        yield {
          type: "task_started",
          workflowId: graph.id,
          taskId,
          timestamp: new Date().toISOString(),
          data: { agentId: node.agentId },
        };

        // Mark task as completed (actual execution would be handled by FleetManager)
        node.status = "completed";
        completed.add(taskId);

        yield {
          type: "task_completed",
          workflowId: graph.id,
          taskId,
          timestamp: new Date().toISOString(),
        };
      }
    }

    if (state) {
      state.status = hasFailure ? "failed" : "completed";
      state.completedAt = new Date();
    }

    yield {
      type: hasFailure ? "workflow_failed" : "workflow_completed",
      workflowId: graph.id,
      timestamp: new Date().toISOString(),
      data: {
        completedTasks: completed.size,
        totalTasks: executionOrder.length,
      },
    };
  }

  /**
   * Get the current status of a workflow.
   */
  getWorkflowStatus(workflowId: string): WorkflowStatus {
    const state = this.workflows.get(workflowId);
    if (!state) {
      logger.warn({ workflowId }, "Workflow not found");
      return "pending";
    }
    return state.status;
  }

  /**
   * Topological sort using Kahn's algorithm.
   * Returns task IDs in execution order. If the result length
   * differs from input length, a cycle exists.
   */
  private topologicalSort(tasks: WorkflowTask[]): string[] {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const task of tasks) {
      inDegree.set(task.id, 0);
      adjacency.set(task.id, []);
    }

    for (const task of tasks) {
      for (const dep of task.dependencies) {
        if (adjacency.has(dep)) {
          adjacency.get(dep)?.push(task.id);
          inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
        }
      }
    }

    // Sort by priority (higher priority first) among zero in-degree nodes
    const queue = tasks
      .filter((t) => (inDegree.get(t.id) ?? 0) === 0)
      .sort((a, b) => b.priority - a.priority)
      .map((t) => t.id);

    const result: string[] = [];
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        break;
      }
      result.push(current);

      const neighbors = adjacency.get(current) ?? [];
      const readyNeighbors: string[] = [];

      for (const neighbor of neighbors) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);

        if (newDegree === 0) {
          readyNeighbors.push(neighbor);
        }
      }

      // Sort newly ready neighbors by priority
      readyNeighbors.sort((a, b) => {
        const pa = taskMap.get(a)?.priority ?? 0;
        const pb = taskMap.get(b)?.priority ?? 0;
        return pb - pa;
      });

      queue.push(...readyNeighbors);
    }

    return result;
  }
}
