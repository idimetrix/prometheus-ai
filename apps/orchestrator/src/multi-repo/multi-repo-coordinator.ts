/**
 * GAP-063: Multi-Repository Orchestration
 *
 * Coordinates changes across multiple repositories. Clones and indexes
 * repos, plans cross-repo changes, creates PRs in each repo, and
 * tracks cross-repo dependencies.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:multi-repo-coordinator");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RepoConfig {
  branch: string;
  localPath?: string;
  name: string;
  url: string;
}

export interface CrossRepoChange {
  dependsOn: string[];
  description: string;
  files: Array<{ path: string; action: "create" | "modify" | "delete" }>;
  repoName: string;
}

export interface CrossRepoPlan {
  changes: CrossRepoChange[];
  createdAt: number;
  description: string;
  id: string;
  status: "planning" | "executing" | "completed" | "failed";
}

export interface RepoPR {
  prNumber: number;
  prUrl: string;
  repoName: string;
  status: "open" | "merged" | "closed";
}

// ─── Multi-Repo Coordinator ──────────────────────────────────────────────────

export class MultiRepoCoordinator {
  private readonly repos = new Map<string, RepoConfig>();
  private readonly plans = new Map<string, CrossRepoPlan>();
  private readonly prs = new Map<string, RepoPR[]>();

  /**
   * Register a repository for cross-repo coordination.
   */
  registerRepo(config: RepoConfig): void {
    this.repos.set(config.name, config);
    logger.info(
      { repoName: config.name, url: config.url },
      "Repository registered for multi-repo coordination"
    );
  }

  /**
   * Plan cross-repo changes with dependency ordering.
   */
  createPlan(description: string, changes: CrossRepoChange[]): CrossRepoPlan {
    const id = `mrp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Validate all repos exist
    for (const change of changes) {
      if (!this.repos.has(change.repoName)) {
        throw new Error(`Repository "${change.repoName}" not registered`);
      }
    }

    // Topological sort for dependency ordering
    const ordered = this.topologicalSort(changes);

    const plan: CrossRepoPlan = {
      id,
      description,
      changes: ordered,
      status: "planning",
      createdAt: Date.now(),
    };

    this.plans.set(id, plan);

    logger.info(
      {
        planId: id,
        repoCount: new Set(changes.map((c) => c.repoName)).size,
        changeCount: changes.length,
      },
      "Cross-repo plan created"
    );

    return plan;
  }

  /**
   * Execute a cross-repo plan, applying changes in dependency order.
   */
  async executePlan(
    planId: string,
    applyChange: (
      change: CrossRepoChange,
      repo: RepoConfig
    ) => Promise<{ prNumber: number; prUrl: string }>
  ): Promise<RepoPR[]> {
    const plan = this.plans.get(planId);
    if (!plan) {
      throw new Error(`Plan "${planId}" not found`);
    }

    plan.status = "executing";
    const createdPRs: RepoPR[] = [];

    for (const change of plan.changes) {
      const repo = this.repos.get(change.repoName);
      if (!repo) {
        plan.status = "failed";
        throw new Error(`Repository "${change.repoName}" not found`);
      }

      try {
        const result = await applyChange(change, repo);

        const pr: RepoPR = {
          repoName: change.repoName,
          prNumber: result.prNumber,
          prUrl: result.prUrl,
          status: "open",
        };

        createdPRs.push(pr);

        logger.info(
          {
            planId,
            repoName: change.repoName,
            prNumber: result.prNumber,
          },
          "Cross-repo PR created"
        );
      } catch (error) {
        plan.status = "failed";
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(
          { planId, repoName: change.repoName, error: msg },
          "Failed to apply cross-repo change"
        );
        throw error;
      }
    }

    plan.status = "completed";
    this.prs.set(planId, createdPRs);

    logger.info(
      { planId, prCount: createdPRs.length },
      "Cross-repo plan executed successfully"
    );

    return createdPRs;
  }

  /**
   * Get all registered repos.
   */
  getRepos(): RepoConfig[] {
    return [...this.repos.values()];
  }

  /**
   * Get plan status.
   */
  getPlan(planId: string): CrossRepoPlan | undefined {
    return this.plans.get(planId);
  }

  /**
   * Get PRs created for a plan.
   */
  getPRs(planId: string): RepoPR[] {
    return this.prs.get(planId) ?? [];
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private topologicalSort(changes: CrossRepoChange[]): CrossRepoChange[] {
    const sorted: CrossRepoChange[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (change: CrossRepoChange): void => {
      if (visited.has(change.repoName)) {
        return;
      }
      if (visiting.has(change.repoName)) {
        logger.warn(
          { repoName: change.repoName },
          "Circular dependency detected in cross-repo plan"
        );
        return;
      }

      visiting.add(change.repoName);

      for (const dep of change.dependsOn) {
        const depChange = changes.find((c) => c.repoName === dep);
        if (depChange) {
          visit(depChange);
        }
      }

      visiting.delete(change.repoName);
      visited.add(change.repoName);
      sorted.push(change);
    };

    for (const change of changes) {
      visit(change);
    }

    return sorted;
  }
}
