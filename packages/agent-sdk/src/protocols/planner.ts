import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { Blueprint, Workstream } from "./architect";

const logger = createLogger("agent-sdk:protocol:planner");

export interface SprintPlan {
  id: string;
  projectId: string;
  totalEstimatedCredits: number;
  tasks: SprintTask[];
  dependencies: TaskDependency[];
  parallelGroups: ParallelGroup[];
}

export interface SprintTask {
  id: string;
  title: string;
  description: string;
  agentRole: string;
  estimatedCredits: number;
  priority: number;
  dependencies: string[];
  status: "pending" | "in_progress" | "completed" | "failed";
}

export interface TaskDependency {
  taskId: string;
  dependsOn: string;
}

export interface ParallelGroup {
  id: string;
  name: string;
  taskIds: string[];
}

export class PlannerProtocol {
  private plan: SprintPlan;

  constructor(private projectId: string) {
    this.plan = {
      id: generateId("plan"),
      projectId,
      totalEstimatedCredits: 0,
      tasks: [],
      dependencies: [],
      parallelGroups: [],
    };
  }

  createFromBlueprint(blueprint: Blueprint): SprintPlan {
    const workstreams = blueprint.parallelWorkstreams;

    for (const ws of workstreams) {
      const group: ParallelGroup = {
        id: generateId("pg"),
        name: ws.name,
        taskIds: [],
      };

      for (const taskDesc of ws.tasks) {
        const task = this.createTask(taskDesc, ws);
        this.plan.tasks.push(task);
        group.taskIds.push(task.id);
      }

      if (ws.parallelizable) {
        this.plan.parallelGroups.push(group);
      }

      // Add dependencies
      for (const depName of ws.dependencies) {
        const depWorkstream = workstreams.find((w) => w.name === depName);
        if (depWorkstream) {
          for (const taskId of group.taskIds) {
            // Each task in this group depends on all tasks in the dependency workstream
            const depGroup = this.plan.parallelGroups.find(
              (pg) => pg.name === depName
            );
            if (depGroup) {
              for (const depTaskId of depGroup.taskIds) {
                this.plan.dependencies.push({
                  taskId,
                  dependsOn: depTaskId,
                });
              }
            }
          }
        }
      }
    }

    this.plan.totalEstimatedCredits = this.plan.tasks.reduce(
      (sum, t) => sum + t.estimatedCredits, 0
    );

    return this.plan;
  }

  createFromDescription(description: string, agentRole?: string): SprintPlan {
    // Simple task decomposition from a text description
    const task: SprintTask = {
      id: generateId("st"),
      title: description.slice(0, 100),
      description,
      agentRole: agentRole ?? this.inferAgentRole(description),
      estimatedCredits: this.estimateCredits(description),
      priority: 50,
      dependencies: [],
      status: "pending",
    };

    this.plan.tasks.push(task);
    this.plan.totalEstimatedCredits = task.estimatedCredits;

    return this.plan;
  }

  getExecutionOrder(): SprintTask[][] {
    // Topological sort to get execution waves
    const waves: SprintTask[][] = [];
    const completed = new Set<string>();
    const remaining = new Map(this.plan.tasks.map((t) => [t.id, t]));

    while (remaining.size > 0) {
      const wave: SprintTask[] = [];

      for (const [id, task] of remaining) {
        const deps = this.plan.dependencies
          .filter((d) => d.taskId === id)
          .map((d) => d.dependsOn);

        if (deps.every((d) => completed.has(d))) {
          wave.push(task);
        }
      }

      if (wave.length === 0) {
        // Break circular dependencies by taking the first remaining
        const first = remaining.values().next().value;
        if (first) wave.push(first);
      }

      for (const task of wave) {
        remaining.delete(task.id);
        completed.add(task.id);
      }

      waves.push(wave);
    }

    return waves;
  }

  getPlan(): SprintPlan {
    return this.plan;
  }

  private createTask(description: string, workstream: Workstream): SprintTask {
    return {
      id: generateId("st"),
      title: description,
      description: `${workstream.name}: ${description}`,
      agentRole: this.inferAgentRole(description),
      estimatedCredits: Math.ceil(workstream.estimatedCredits / workstream.tasks.length),
      priority: 50,
      dependencies: [],
      status: "pending",
    };
  }

  private inferAgentRole(description: string): string {
    const lower = description.toLowerCase();

    if (lower.includes("database") || lower.includes("schema") || lower.includes("migration") || lower.includes("orm")) {
      return "backend_coder";
    }
    if (lower.includes("api") || lower.includes("endpoint") || lower.includes("route") || lower.includes("service")) {
      return "backend_coder";
    }
    if (lower.includes("component") || lower.includes("page") || lower.includes("layout") || lower.includes("ui") || lower.includes("frontend")) {
      return "frontend_coder";
    }
    if (lower.includes("connect") || lower.includes("wire") || lower.includes("integration") || lower.includes("client")) {
      return "integration_coder";
    }
    if (lower.includes("test") || lower.includes("spec") || lower.includes("coverage")) {
      return "test_engineer";
    }
    if (lower.includes("security") || lower.includes("audit") || lower.includes("vulnerability")) {
      return "security_auditor";
    }
    if (lower.includes("deploy") || lower.includes("docker") || lower.includes("ci/cd") || lower.includes("kubernetes")) {
      return "deploy_engineer";
    }

    return "backend_coder";
  }

  private estimateCredits(description: string): number {
    const length = description.length;
    if (length < 100) return 5;
    if (length < 500) return 15;
    return 30;
  }
}
