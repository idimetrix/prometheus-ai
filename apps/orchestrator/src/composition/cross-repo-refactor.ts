/**
 * Cross-Repository Refactoring (MOON-003)
 *
 * Performs coordinated refactoring across multiple repositories.
 * Plans changes, determines dependency ordering, identifies breaking
 * changes, and executes refactoring with linked PRs.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:composition:cross-repo-refactor");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RefactorType =
  | "rename"
  | "extract"
  | "move"
  | "deprecate"
  | "version_bump";

export interface CrossRepoRefactorOptions {
  description: string;
  projectId: string;
  refactorType: RefactorType;
  scope: {
    /** Optional glob or regex pattern to match files within repos */
    pattern?: string;
    repos: string[];
  };
}

export interface RefactorPlan {
  affectedRepos: Array<{
    changes: string[];
    files: number;
    repo: string;
  }>;
  breakingChanges: Array<{
    change: string;
    mitigation: string;
    repo: string;
  }>;
  /** Order in which repos should be updated to avoid breakage */
  dependencyOrder: string[];
  estimatedPRs: number;
  id: string;
}

export interface RefactorExecution {
  prs: Array<{
    prUrl: string;
    repo: string;
    status: "created" | "merged" | "failed";
  }>;
  summary: string;
}

interface RepoDependencyGraph {
  /** repo -> repos it depends on */
  edges: Map<string, Set<string>>;
  nodes: Set<string>;
}

// ---------------------------------------------------------------------------
// CrossRepoRefactor
// ---------------------------------------------------------------------------

export class CrossRepoRefactor {
  private readonly plans = new Map<string, RefactorPlan>();

  /**
   * Plan a cross-repo refactoring operation.
   *
   * 1. Analyze each repo for files matching the pattern
   * 2. Determine dependency ordering
   * 3. Identify breaking changes and mitigations
   * 4. Estimate number of PRs
   */
  plan(options: CrossRepoRefactorOptions): RefactorPlan {
    const { projectId, refactorType, scope, description } = options;

    logger.info(
      {
        projectId,
        refactorType,
        repoCount: scope.repos.length,
        pattern: scope.pattern,
      },
      "Planning cross-repo refactoring"
    );

    // Analyze affected repos
    const affectedRepos = this.analyzeAffectedRepos(
      scope.repos,
      refactorType,
      scope.pattern
    );

    // Build dependency graph and determine ordering
    const graph = this.buildDependencyGraph(scope.repos);
    const dependencyOrder = this.topologicalSort(graph);

    // Identify breaking changes
    const breakingChanges = this.identifyBreakingChanges(
      affectedRepos,
      refactorType,
      description
    );

    // One PR per affected repo
    const estimatedPRs = affectedRepos.filter((r) => r.files > 0).length;

    const plan: RefactorPlan = {
      id: generateId("rfp"),
      affectedRepos,
      dependencyOrder,
      breakingChanges,
      estimatedPRs,
    };

    this.plans.set(plan.id, plan);

    logger.info(
      {
        planId: plan.id,
        affectedRepos: affectedRepos.length,
        breakingChanges: breakingChanges.length,
        estimatedPRs,
      },
      "Cross-repo refactoring plan created"
    );

    return plan;
  }

  /**
   * Execute a previously created refactoring plan.
   * Creates PRs in dependency order and tracks their status.
   */
  execute(plan: RefactorPlan): RefactorExecution {
    logger.info(
      { planId: plan.id, repoOrder: plan.dependencyOrder },
      "Executing cross-repo refactoring"
    );

    const prs: RefactorExecution["prs"] = [];

    // Process repos in dependency order
    for (const repo of plan.dependencyOrder) {
      const repoInfo = plan.affectedRepos.find((r) => r.repo === repo);
      if (!repoInfo || repoInfo.files === 0) {
        continue;
      }

      try {
        // In production, this would create a branch, apply changes, and open a PR
        const prUrl = `https://github.com/org/${repo}/pull/${generateId("pr")}`;
        prs.push({ repo, prUrl, status: "created" });

        logger.info(
          { repo, prUrl, changes: repoInfo.changes.length },
          "Created PR for repo"
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ repo, error: msg }, "Failed to create PR for repo");
        prs.push({
          repo,
          prUrl: "",
          status: "failed",
        });
      }
    }

    const created = prs.filter((p) => p.status === "created").length;
    const failed = prs.filter((p) => p.status === "failed").length;

    const summary = [
      `Cross-repo refactoring complete: ${created} PRs created`,
      failed > 0 ? `, ${failed} failed` : "",
      `. Repos processed in order: ${plan.dependencyOrder.join(" -> ")}`,
    ].join("");

    logger.info({ created, failed, summary }, "Refactoring execution complete");

    return { prs, summary };
  }

  /**
   * Retrieve a previously created plan.
   */
  getPlan(planId: string): RefactorPlan | undefined {
    return this.plans.get(planId);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private analyzeAffectedRepos(
    repos: string[],
    refactorType: RefactorType,
    pattern?: string
  ): RefactorPlan["affectedRepos"] {
    return repos.map((repo) => {
      const changes = this.estimateChanges(repo, refactorType, pattern);
      return {
        repo,
        files: changes.length,
        changes,
      };
    });
  }

  private estimateChanges(
    repo: string,
    refactorType: RefactorType,
    pattern?: string
  ): string[] {
    // In production, this would scan the actual repo files.
    // Here we generate representative change descriptions.
    const changes: string[] = [];
    const patternSuffix = pattern ? ` matching ${pattern}` : "";

    switch (refactorType) {
      case "rename": {
        changes.push(`Rename identifiers${patternSuffix} in ${repo}`);
        changes.push(`Update import paths in ${repo}`);
        changes.push(`Update configuration references in ${repo}`);
        break;
      }
      case "extract": {
        changes.push(`Extract shared module${patternSuffix} from ${repo}`);
        changes.push(`Add dependency on extracted package in ${repo}`);
        changes.push(`Update imports to use extracted module in ${repo}`);
        break;
      }
      case "move": {
        changes.push(`Move files${patternSuffix} in ${repo}`);
        changes.push(`Update import paths after move in ${repo}`);
        break;
      }
      case "deprecate": {
        changes.push(`Add deprecation notices${patternSuffix} in ${repo}`);
        changes.push(`Update documentation for deprecated APIs in ${repo}`);
        break;
      }
      case "version_bump": {
        changes.push(`Bump dependency versions in ${repo}`);
        changes.push(`Update lock file in ${repo}`);
        changes.push(`Fix breaking API changes from version bump in ${repo}`);
        break;
      }
      default:
        break;
    }

    return changes;
  }

  private buildDependencyGraph(repos: string[]): RepoDependencyGraph {
    const graph: RepoDependencyGraph = {
      nodes: new Set(repos),
      edges: new Map(),
    };

    // Initialize edges
    for (const repo of repos) {
      graph.edges.set(repo, new Set());
    }

    // In production, this would analyze actual package manifests.
    // Repos appearing later in the list are assumed to depend on earlier ones.
    for (let i = 1; i < repos.length; i++) {
      const repo = repos[i];
      const prev = repos[i - 1];
      if (repo && prev) {
        const deps = graph.edges.get(repo) ?? new Set<string>();
        deps.add(prev);
        graph.edges.set(repo, deps);
      }
    }

    return graph;
  }

  private topologicalSort(graph: RepoDependencyGraph): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (node: string) => {
      if (visited.has(node)) {
        return;
      }
      if (visiting.has(node)) {
        // Cycle detected — just skip to avoid infinite loop
        return;
      }

      visiting.add(node);
      const deps = graph.edges.get(node) ?? new Set<string>();
      for (const dep of deps) {
        visit(dep);
      }
      visiting.delete(node);
      visited.add(node);
      sorted.push(node);
    };

    for (const node of graph.nodes) {
      visit(node);
    }

    return sorted;
  }

  private identifyBreakingChanges(
    affectedRepos: RefactorPlan["affectedRepos"],
    refactorType: RefactorType,
    description: string
  ): RefactorPlan["breakingChanges"] {
    const breakingChanges: RefactorPlan["breakingChanges"] = [];

    for (const repo of affectedRepos) {
      if (repo.files === 0) {
        continue;
      }

      switch (refactorType) {
        case "rename": {
          breakingChanges.push({
            repo: repo.repo,
            change: `Renamed identifiers will break consumers importing from ${repo.repo}`,
            mitigation:
              "Re-export old names as deprecated aliases during transition",
          });
          break;
        }
        case "extract": {
          breakingChanges.push({
            repo: repo.repo,
            change: `Extracting module changes import paths for consumers of ${repo.repo}`,
            mitigation:
              "Add barrel re-exports in original location pointing to new package",
          });
          break;
        }
        case "move": {
          breakingChanges.push({
            repo: repo.repo,
            change: `Moved files change the public API surface of ${repo.repo}`,
            mitigation:
              "Update path mappings and add re-exports from old locations",
          });
          break;
        }
        case "version_bump": {
          breakingChanges.push({
            repo: repo.repo,
            change: `Version bump may introduce breaking API changes in ${repo.repo}`,
            mitigation: `Review ${description} changelog and update affected call sites`,
          });
          break;
        }
        case "deprecate": {
          // Deprecation is non-breaking by nature
          break;
        }
        default:
          break;
      }
    }

    return breakingChanges;
  }
}
