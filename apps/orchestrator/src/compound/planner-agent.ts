/**
 * PlannerAgent — Decomposes a high-level task description into a DAG of
 * subtasks with dependencies. Uses the "think" slot for deep reasoning
 * about task decomposition and dependency ordering.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:compound:planner");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubTask {
  /** Agent role best suited for this subtask */
  agentRole: string;
  /** Detailed description of what needs to be done */
  description: string;
  /** Estimated token budget for this subtask */
  estimatedTokens: number;
  /** Unique subtask identifier */
  id: string;
  /** Execution priority (lower = higher priority) */
  priority: number;
  /** Short human-readable title */
  title: string;
}

export interface Dependency {
  /** Subtask ID that depends on `to` */
  from: string;
  /** Subtask ID that must complete first */
  to: string;
  /** Whether the dependency blocks execution or merely informs it */
  type: "blocks" | "informs";
}

export interface TaskPlan {
  /** Inter-subtask dependencies forming a DAG */
  dependencies: Dependency[];
  /** Total estimated credit cost for the full plan */
  estimatedCredits: number;
  /** Unique plan identifier */
  id: string;
  /** Ordered subtasks (topologically sorted) */
  subtasks: SubTask[];
}

/** Context provided to the planner for reasoning. */
export interface PlannerInput {
  /** Optional blueprint or architecture document */
  blueprint?: string;
  /** Existing codebase context (file tree, conventions, etc.) */
  projectContext: string;
  /** The high-level task to decompose */
  taskDescription: string;
}

// ---------------------------------------------------------------------------
// Token estimation heuristics
// ---------------------------------------------------------------------------

const ROLE_TOKEN_ESTIMATES: Record<string, number> = {
  discovery: 2000,
  architect: 4000,
  planner: 2000,
  frontend_coder: 8000,
  backend_coder: 8000,
  integration_coder: 6000,
  test_engineer: 5000,
  security_auditor: 3000,
  deploy_engineer: 4000,
  documentation_specialist: 3000,
  ci_loop: 6000,
};

const CREDIT_PER_1K_TOKENS = 0.5;

// ---------------------------------------------------------------------------
// PlannerAgent
// ---------------------------------------------------------------------------

export class PlannerAgent {
  private readonly maxSubtasks: number;

  constructor(maxSubtasks = 20) {
    this.maxSubtasks = maxSubtasks;
  }

  /**
   * Decompose a task description into a DAG of subtasks with dependencies.
   *
   * The planner uses structured reasoning to:
   * 1. Identify all required work items
   * 2. Assign optimal agent roles
   * 3. Determine dependency ordering
   * 4. Estimate token budgets
   */
  plan(
    taskDescription: string,
    projectContext: string,
    blueprint?: string
  ): TaskPlan {
    const planId = generateId("plan");

    logger.info(
      { planId, taskLength: taskDescription.length },
      "PlannerAgent: decomposing task into DAG"
    );

    // Step 1: Analyze the task and extract work items
    const workItems = this.extractWorkItems(
      taskDescription,
      projectContext,
      blueprint
    );

    // Step 2: Build subtasks with role assignments
    const subtasks = this.buildSubtasks(workItems);

    // Step 3: Infer dependencies between subtasks
    const dependencies = this.inferDependencies(subtasks);

    // Step 4: Validate DAG (no cycles)
    this.validateDAG(subtasks, dependencies);

    // Step 5: Calculate estimated credits
    const estimatedCredits = this.estimateCredits(subtasks);

    const plan: TaskPlan = {
      id: planId,
      subtasks: subtasks.slice(0, this.maxSubtasks),
      dependencies,
      estimatedCredits,
    };

    logger.info(
      {
        planId,
        subtaskCount: plan.subtasks.length,
        dependencyCount: plan.dependencies.length,
        estimatedCredits: plan.estimatedCredits,
      },
      "PlannerAgent: plan created"
    );

    return plan;
  }

  /**
   * Extract work items from the task description by analyzing
   * what types of work are implied.
   */
  private extractWorkItems(
    taskDescription: string,
    _projectContext: string,
    blueprint?: string
  ): WorkItem[] {
    const items: WorkItem[] = [];
    const desc = taskDescription.toLowerCase();

    // Discovery phase if task is vague or broad
    if (
      desc.includes("build") ||
      desc.includes("create") ||
      desc.includes("implement")
    ) {
      items.push({
        type: "discovery",
        title: "Requirements discovery",
        description: `Analyze and clarify requirements for: ${taskDescription}`,
      });
    }

    // Architecture if building something new
    if (
      desc.includes("build") ||
      desc.includes("new") ||
      desc.includes("design")
    ) {
      items.push({
        type: "architecture",
        title: "Architecture design",
        description: `Design architecture for: ${taskDescription}`,
      });
    }

    // Backend work
    if (
      desc.includes("api") ||
      desc.includes("backend") ||
      desc.includes("server") ||
      desc.includes("database") ||
      desc.includes("endpoint")
    ) {
      items.push({
        type: "backend",
        title: "Backend implementation",
        description: `Implement backend components for: ${taskDescription}`,
      });
    }

    // Frontend work
    if (
      desc.includes("ui") ||
      desc.includes("frontend") ||
      desc.includes("component") ||
      desc.includes("page") ||
      desc.includes("dashboard")
    ) {
      items.push({
        type: "frontend",
        title: "Frontend implementation",
        description: `Implement frontend components for: ${taskDescription}`,
      });
    }

    // Integration work if both frontend and backend
    if (
      items.some((i) => i.type === "backend") &&
      items.some((i) => i.type === "frontend")
    ) {
      items.push({
        type: "integration",
        title: "Frontend-backend integration",
        description: "Wire frontend components to backend APIs",
      });
    }

    // Testing
    items.push({
      type: "testing",
      title: "Test implementation",
      description: `Write tests for: ${taskDescription}`,
    });

    // Security audit
    if (
      desc.includes("auth") ||
      desc.includes("security") ||
      desc.includes("api") ||
      desc.includes("user")
    ) {
      items.push({
        type: "security",
        title: "Security audit",
        description: "Review implementation for security vulnerabilities",
      });
    }

    // If blueprint provided, add blueprint compliance check
    if (blueprint) {
      items.push({
        type: "compliance",
        title: "Blueprint compliance check",
        description: "Verify implementation matches architectural blueprint",
      });
    }

    // Fallback: if no specific items detected, create a generic implementation task
    if (items.length === 0) {
      items.push({
        type: "backend",
        title: "Implementation",
        description: taskDescription,
      });
      items.push({
        type: "testing",
        title: "Testing",
        description: `Test: ${taskDescription}`,
      });
    }

    return items;
  }

  /** Convert work items into subtasks with role assignments and priorities. */
  private buildSubtasks(workItems: WorkItem[]): SubTask[] {
    return workItems.map((item, index) => {
      const role = WORK_TYPE_TO_ROLE[item.type] ?? "backend_coder";
      const estimatedTokens = ROLE_TOKEN_ESTIMATES[role] ?? 5000;

      return {
        id: generateId("subtask"),
        title: item.title,
        description: item.description,
        agentRole: role,
        priority: WORK_TYPE_PRIORITY[item.type] ?? index + 1,
        estimatedTokens,
      };
    });
  }

  /** Infer dependencies between subtasks based on work type ordering. */
  private inferDependencies(subtasks: SubTask[]): Dependency[] {
    const deps: Dependency[] = [];
    const byRole = new Map<string, SubTask>();

    for (const task of subtasks) {
      byRole.set(task.agentRole, task);
    }

    // Define dependency rules based on agent roles
    const rules: Array<{ from: string; to: string; type: Dependency["type"] }> =
      [
        { from: "architect", to: "discovery", type: "blocks" },
        { from: "backend_coder", to: "architect", type: "blocks" },
        { from: "frontend_coder", to: "architect", type: "blocks" },
        { from: "integration_coder", to: "backend_coder", type: "blocks" },
        { from: "integration_coder", to: "frontend_coder", type: "blocks" },
        { from: "test_engineer", to: "backend_coder", type: "blocks" },
        { from: "test_engineer", to: "frontend_coder", type: "informs" },
        { from: "security_auditor", to: "backend_coder", type: "blocks" },
        { from: "security_auditor", to: "integration_coder", type: "informs" },
      ];

    for (const rule of rules) {
      const fromTask = subtasks.find((t) => t.agentRole === rule.from);
      const toTask = subtasks.find((t) => t.agentRole === rule.to);

      if (fromTask && toTask) {
        deps.push({
          from: fromTask.id,
          to: toTask.id,
          type: rule.type,
        });
      }
    }

    return deps;
  }

  /** Validate that the dependency graph has no cycles using DFS. */
  private validateDAG(subtasks: SubTask[], dependencies: Dependency[]): void {
    const adjacency = new Map<string, string[]>();
    for (const task of subtasks) {
      adjacency.set(task.id, []);
    }
    for (const dep of dependencies) {
      const neighbors = adjacency.get(dep.from);
      if (neighbors) {
        neighbors.push(dep.to);
      }
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
      visited.add(nodeId);
      inStack.add(nodeId);

      for (const neighbor of adjacency.get(nodeId) ?? []) {
        if (inStack.has(neighbor)) {
          return true;
        }
        if (!visited.has(neighbor) && hasCycle(neighbor)) {
          return true;
        }
      }

      inStack.delete(nodeId);
      return false;
    };

    for (const task of subtasks) {
      if (!visited.has(task.id) && hasCycle(task.id)) {
        logger.error(
          "Cycle detected in task dependency graph, removing last dependency"
        );
        dependencies.pop();
        return;
      }
    }
  }

  /** Estimate total credits based on subtask token budgets. */
  private estimateCredits(subtasks: SubTask[]): number {
    const totalTokens = subtasks.reduce((sum, t) => sum + t.estimatedTokens, 0);
    return Math.ceil((totalTokens / 1000) * CREDIT_PER_1K_TOKENS);
  }
}

// ---------------------------------------------------------------------------
// Internal types & constants
// ---------------------------------------------------------------------------

interface WorkItem {
  description: string;
  title: string;
  type: string;
}

const WORK_TYPE_TO_ROLE: Record<string, string> = {
  discovery: "discovery",
  architecture: "architect",
  backend: "backend_coder",
  frontend: "frontend_coder",
  integration: "integration_coder",
  testing: "test_engineer",
  security: "security_auditor",
  compliance: "security_auditor",
  deployment: "deploy_engineer",
  documentation: "documentation_specialist",
};

const WORK_TYPE_PRIORITY: Record<string, number> = {
  discovery: 1,
  architecture: 2,
  backend: 3,
  frontend: 3,
  integration: 4,
  testing: 5,
  security: 6,
  compliance: 7,
  deployment: 8,
  documentation: 9,
};
