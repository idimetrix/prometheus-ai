import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { Blueprint, Workstream } from "./architect";

const _logger = createLogger("agent-sdk:protocol:planner");

export interface SprintPlan {
  dependencies: TaskDependency[];
  id: string;
  parallelGroups: ParallelGroup[];
  projectId: string;
  tasks: SprintTask[];
  totalEstimatedCredits: number;
}

export interface SprintTask {
  agentRole: string;
  dependencies: string[];
  description: string;
  estimatedCredits: number;
  id: string;
  priority: number;
  status: "pending" | "in_progress" | "completed" | "failed";
  title: string;
}

export interface TaskDependency {
  dependsOn: string;
  taskId: string;
}

export interface ParallelGroup {
  id: string;
  name: string;
  taskIds: string[];
}

export class PlannerProtocol {
  private readonly plan: SprintPlan;

  constructor(projectId: string) {
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
      const group = this.createWorkstreamGroup(ws);
      if (ws.parallelizable) {
        this.plan.parallelGroups.push(group);
      }
      this.addWorkstreamDependencies(group, ws.dependencies);
    }

    this.plan.totalEstimatedCredits = this.plan.tasks.reduce(
      (sum, t) => sum + t.estimatedCredits,
      0
    );

    return this.plan;
  }

  private createWorkstreamGroup(ws: Workstream): ParallelGroup {
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
    return group;
  }

  private addWorkstreamDependencies(
    group: ParallelGroup,
    depNames: string[]
  ): void {
    for (const depName of depNames) {
      const depGroup = this.plan.parallelGroups.find(
        (pg) => pg.name === depName
      );
      if (!depGroup) {
        continue;
      }
      for (const taskId of group.taskIds) {
        for (const depTaskId of depGroup.taskIds) {
          this.plan.dependencies.push({ taskId, dependsOn: depTaskId });
        }
      }
    }
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
        if (first) {
          wave.push(first);
        }
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
      estimatedCredits: Math.ceil(
        workstream.estimatedCredits / workstream.tasks.length
      ),
      priority: 50,
      dependencies: [],
      status: "pending",
    };
  }

  private static readonly ROLE_KEYWORDS: Array<{
    keywords: string[];
    role: string;
  }> = [
    {
      keywords: ["database", "schema", "migration", "orm"],
      role: "backend_coder",
    },
    {
      keywords: ["api", "endpoint", "route", "service"],
      role: "backend_coder",
    },
    {
      keywords: ["component", "page", "layout", "ui", "frontend"],
      role: "frontend_coder",
    },
    {
      keywords: ["connect", "wire", "integration", "client"],
      role: "integration_coder",
    },
    { keywords: ["test", "spec", "coverage"], role: "test_engineer" },
    {
      keywords: ["security", "audit", "vulnerability"],
      role: "security_auditor",
    },
    {
      keywords: ["deploy", "docker", "ci/cd", "kubernetes"],
      role: "deploy_engineer",
    },
  ];

  private inferAgentRole(description: string): string {
    const lower = description.toLowerCase();
    for (const entry of PlannerProtocol.ROLE_KEYWORDS) {
      if (entry.keywords.some((kw) => lower.includes(kw))) {
        return entry.role;
      }
    }
    return "backend_coder";
  }

  private estimateCredits(description: string): number {
    const length = description.length;
    if (length < 100) {
      return 5;
    }
    if (length < 500) {
      return 15;
    }
    return 30;
  }
}
