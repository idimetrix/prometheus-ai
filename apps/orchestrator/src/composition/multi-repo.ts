/**
 * Multi-Repository Orchestration
 *
 * Coordinates agent execution across multiple repositories,
 * detects cross-repo dependencies, and creates linked PRs.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:multi-repo");

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RepoRegistration {
  defaultBranch: string;
  id: string;
  /** Languages detected */
  languages: string[];
  /** Package manager manifest path (package.json, go.mod, etc.) */
  manifestPath: string;
  name: string;
  projectId: string;
  url: string;
}

export interface CrossRepoDependency {
  /** Package or module name */
  packageName: string;
  /** Source repo that depends on target */
  sourceRepoId: string;
  /** Target repo that provides the dependency */
  targetRepoId: string;
  /** Type of dependency */
  type: "npm" | "go" | "python" | "internal_api" | "shared_types";
  /** Current version constraint */
  versionConstraint?: string;
}

export interface CrossRepoTask {
  agentRole: string;
  dependencies: string[];
  description: string;
  id: string;
  repoId: string;
  /** Shared contract this task must conform to */
  sharedContract?: string;
}

export interface CrossRepoPlan {
  description: string;
  estimatedCost: number;
  id: string;
  linkedPRs: Array<{ repoId: string; prUrl?: string }>;
  sharedContracts: string[];
  tasks: CrossRepoTask[];
}

export interface ImpactAssessment {
  /** Files that need updating across repos */
  affectedFiles: Array<{ repoId: string; filePath: string; reason: string }>;
  /** Repos directly affected */
  directlyAffected: string[];
  /** Risk level */
  risk: "low" | "medium" | "high";
  /** Repos transitively affected */
  transitivelyAffected: string[];
}

// ─── MultiRepoOrchestrator ─────────────────────────────────────────────────────

export class MultiRepoOrchestrator {
  private readonly repos = new Map<string, RepoRegistration>();
  private readonly dependencies: CrossRepoDependency[] = [];

  /**
   * Register a repository in the orchestrator.
   */
  registerRepo(repo: Omit<RepoRegistration, "id">): RepoRegistration {
    const registration: RepoRegistration = {
      ...repo,
      id: generateId("repo"),
    };
    this.repos.set(registration.id, registration);
    logger.info(
      { repoId: registration.id, name: registration.name },
      "Registered repository"
    );
    return registration;
  }

  /**
   * Register a cross-repo dependency.
   */
  addDependency(dep: CrossRepoDependency): void {
    this.dependencies.push(dep);
    logger.debug(
      {
        source: dep.sourceRepoId,
        target: dep.targetRepoId,
        type: dep.type,
        package: dep.packageName,
      },
      "Cross-repo dependency registered"
    );
  }

  /**
   * Analyze the impact of changing a module in a specific repo.
   */
  analyzeImpact(repoId: string, changedModule: string): ImpactAssessment {
    const directlyAffected = new Set<string>();
    const transitivelyAffected = new Set<string>();
    const affectedFiles: ImpactAssessment["affectedFiles"] = [];

    // Find repos that depend on the changed repo's module
    for (const dep of this.dependencies) {
      if (
        dep.targetRepoId === repoId &&
        dep.packageName.includes(changedModule)
      ) {
        directlyAffected.add(dep.sourceRepoId);
        affectedFiles.push({
          repoId: dep.sourceRepoId,
          filePath: dep.packageName,
          reason: `Depends on ${changedModule} via ${dep.type}`,
        });
      }
    }

    // Transitive: repos that depend on directly affected repos
    const visited = new Set<string>([repoId, ...directlyAffected]);
    let frontier = new Set(directlyAffected);

    while (frontier.size > 0) {
      const nextFrontier = new Set<string>();
      for (const affectedRepoId of frontier) {
        for (const dep of this.dependencies) {
          if (
            dep.targetRepoId === affectedRepoId &&
            !visited.has(dep.sourceRepoId)
          ) {
            transitivelyAffected.add(dep.sourceRepoId);
            visited.add(dep.sourceRepoId);
            nextFrontier.add(dep.sourceRepoId);
          }
        }
      }
      frontier = nextFrontier;
    }

    const totalAffected = directlyAffected.size + transitivelyAffected.size;
    let risk: "low" | "medium" | "high";
    if (totalAffected > 5) {
      risk = "high";
    } else if (totalAffected > 2) {
      risk = "medium";
    } else {
      risk = "low";
    }

    logger.info(
      {
        repoId,
        changedModule,
        directlyAffected: directlyAffected.size,
        transitivelyAffected: transitivelyAffected.size,
        risk,
      },
      "Cross-repo impact analysis completed"
    );

    return {
      directlyAffected: [...directlyAffected],
      transitivelyAffected: [...transitivelyAffected],
      affectedFiles,
      risk,
    };
  }

  /**
   * Create a cross-repo execution plan.
   */
  createPlan(
    description: string,
    targetRepos: string[],
    sharedContract?: string
  ): CrossRepoPlan {
    const tasks: CrossRepoTask[] = [];
    const contracts = sharedContract ? [sharedContract] : [];

    // Create task per repo with dependency ordering
    for (const repoId of targetRepos) {
      const repo = this.repos.get(repoId);
      if (!repo) {
        continue;
      }

      // Find which other target repos this repo depends on
      const taskDeps = this.dependencies
        .filter(
          (d) =>
            d.sourceRepoId === repoId && targetRepos.includes(d.targetRepoId)
        )
        .map((d) => `task-${d.targetRepoId}`);

      tasks.push({
        id: `task-${repoId}`,
        description: `${description} in ${repo.name}`,
        repoId,
        agentRole: "backend_coder",
        dependencies: taskDeps,
        sharedContract,
      });
    }

    const plan: CrossRepoPlan = {
      id: generateId("plan"),
      description,
      tasks,
      sharedContracts: contracts,
      estimatedCost: tasks.length * 0.1,
      linkedPRs: targetRepos.map((repoId) => ({ repoId })),
    };

    logger.info(
      { planId: plan.id, taskCount: tasks.length, repos: targetRepos.length },
      "Cross-repo plan created"
    );

    return plan;
  }

  /**
   * Get the dependency graph for visualization.
   */
  getDependencyGraph(): {
    nodes: Array<{ id: string; name: string; languages: string[] }>;
    edges: Array<{
      source: string;
      target: string;
      type: string;
      package: string;
    }>;
  } {
    const nodes = [...this.repos.values()].map((r) => ({
      id: r.id,
      name: r.name,
      languages: r.languages,
    }));

    const edges = this.dependencies.map((d) => ({
      source: d.sourceRepoId,
      target: d.targetRepoId,
      type: d.type,
      package: d.packageName,
    }));

    return { nodes, edges };
  }

  /**
   * Get all registered repos.
   */
  getRepos(): RepoRegistration[] {
    return [...this.repos.values()];
  }
}
