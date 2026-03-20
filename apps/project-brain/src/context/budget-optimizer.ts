/**
 * Phase 7.9: Context Budget Optimizer.
 *
 * Dynamically allocates token budget by task type:
 * - Code generation: more semantic context
 * - Planning: more episodic/decision context
 * - Bug fixing: more stack trace/error context
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:budget-optimizer");

export type TaskType =
  | "code_generation"
  | "planning"
  | "bug_fixing"
  | "refactoring"
  | "review"
  | "testing"
  | "documentation"
  | "general";

export interface BudgetAllocation {
  conventions: number;
  episodic: number;
  procedural: number;
  semantic: number;
}

interface BudgetProfile {
  conventions: number;
  episodic: number;
  procedural: number;
  semantic: number;
}

const TASK_PROFILES: Record<TaskType, BudgetProfile> = {
  code_generation: {
    semantic: 0.5,
    episodic: 0.1,
    procedural: 0.15,
    conventions: 0.25,
  },
  planning: {
    semantic: 0.15,
    episodic: 0.4,
    procedural: 0.2,
    conventions: 0.25,
  },
  bug_fixing: {
    semantic: 0.45,
    episodic: 0.3,
    procedural: 0.15,
    conventions: 0.1,
  },
  refactoring: {
    semantic: 0.4,
    episodic: 0.15,
    procedural: 0.15,
    conventions: 0.3,
  },
  review: {
    semantic: 0.35,
    episodic: 0.2,
    procedural: 0.15,
    conventions: 0.3,
  },
  testing: {
    semantic: 0.35,
    episodic: 0.15,
    procedural: 0.3,
    conventions: 0.2,
  },
  documentation: {
    semantic: 0.3,
    episodic: 0.1,
    procedural: 0.2,
    conventions: 0.4,
  },
  general: {
    semantic: 0.35,
    episodic: 0.2,
    procedural: 0.2,
    conventions: 0.25,
  },
};

/**
 * BudgetOptimizer dynamically allocates token budgets
 * based on task type to maximize context relevance.
 */
export class BudgetOptimizer {
  /**
   * Allocate a total token budget across context categories
   * based on the detected task type.
   */
  allocate(taskType: TaskType, totalBudget: number): BudgetAllocation {
    const profile = TASK_PROFILES[taskType] ?? TASK_PROFILES.general;

    const allocation: BudgetAllocation = {
      semantic: Math.floor(totalBudget * profile.semantic),
      episodic: Math.floor(totalBudget * profile.episodic),
      procedural: Math.floor(totalBudget * profile.procedural),
      conventions: Math.floor(totalBudget * profile.conventions),
    };

    // Distribute any rounding remainder to semantic
    const allocated =
      allocation.semantic +
      allocation.episodic +
      allocation.procedural +
      allocation.conventions;
    const remainder = totalBudget - allocated;
    allocation.semantic += remainder;

    logger.debug(
      { taskType, totalBudget, allocation },
      "Budget allocated for task"
    );

    return allocation;
  }

  /**
   * Detect task type from a task description string.
   */
  detectTaskType(description: string): TaskType {
    const lower = description.toLowerCase();

    if (
      this.matchesPatterns(lower, [
        "fix",
        "bug",
        "error",
        "crash",
        "issue",
        "broken",
        "debug",
      ])
    ) {
      return "bug_fixing";
    }
    if (
      this.matchesPatterns(lower, [
        "plan",
        "design",
        "architect",
        "roadmap",
        "strategy",
      ])
    ) {
      return "planning";
    }
    if (
      this.matchesPatterns(lower, [
        "refactor",
        "restructure",
        "reorganize",
        "clean up",
        "simplify",
      ])
    ) {
      return "refactoring";
    }
    if (this.matchesPatterns(lower, ["review", "audit", "check", "inspect"])) {
      return "review";
    }
    if (this.matchesPatterns(lower, ["test", "spec", "coverage", "assert"])) {
      return "testing";
    }
    if (
      this.matchesPatterns(lower, [
        "document",
        "readme",
        "jsdoc",
        "comment",
        "explain",
      ])
    ) {
      return "documentation";
    }
    if (
      this.matchesPatterns(lower, [
        "implement",
        "create",
        "add",
        "build",
        "write",
        "generate",
      ])
    ) {
      return "code_generation";
    }

    return "general";
  }

  private matchesPatterns(text: string, patterns: string[]): boolean {
    return patterns.some((p) => text.includes(p));
  }
}
