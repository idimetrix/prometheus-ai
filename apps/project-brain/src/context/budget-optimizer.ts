/**
 * Phase 7.9: Context Budget Optimizer.
 *
 * Task-type-aware context selection with priority content categories:
 * - bug_fixing: prioritize stack traces, error logs
 * - code_generation: prioritize conventions, API/type definitions
 * - refactoring: prioritize dependency graph, type definitions
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

export interface DetailedBudgetAllocation extends BudgetAllocation {
  priorityContent: PriorityContentConfig;
  taskType: TaskType;
  totalBudget: number;
}

export interface PriorityContentConfig {
  includeConventions: boolean;
  includeDependencyGraph: boolean;
  includeErrorLogs: boolean;
  includeStackTraces: boolean;
  includeTestContext: boolean;
  priorities: PriorityItem[];
}

export interface PriorityItem {
  reservedTokens: number;
  type:
    | "stack_trace"
    | "error_log"
    | "convention"
    | "dependency_graph"
    | "test_file"
    | "recent_change"
    | "api_definition"
    | "type_definition";
  weight: number;
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
  review: { semantic: 0.35, episodic: 0.2, procedural: 0.15, conventions: 0.3 },
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

const TASK_PRIORITY_CONTENT: Record<TaskType, PriorityContentConfig> = {
  bug_fixing: {
    priorities: [
      { type: "stack_trace", reservedTokens: 2000, weight: 1.0 },
      { type: "error_log", reservedTokens: 1500, weight: 0.9 },
      { type: "recent_change", reservedTokens: 1000, weight: 0.7 },
      { type: "test_file", reservedTokens: 800, weight: 0.6 },
    ],
    includeDependencyGraph: true,
    includeStackTraces: true,
    includeConventions: false,
    includeErrorLogs: true,
    includeTestContext: true,
  },
  code_generation: {
    priorities: [
      { type: "convention", reservedTokens: 2000, weight: 1.0 },
      { type: "api_definition", reservedTokens: 1500, weight: 0.9 },
      { type: "type_definition", reservedTokens: 1200, weight: 0.85 },
      { type: "dependency_graph", reservedTokens: 800, weight: 0.6 },
    ],
    includeDependencyGraph: true,
    includeStackTraces: false,
    includeConventions: true,
    includeErrorLogs: false,
    includeTestContext: false,
  },
  refactoring: {
    priorities: [
      { type: "dependency_graph", reservedTokens: 2500, weight: 1.0 },
      { type: "type_definition", reservedTokens: 1500, weight: 0.85 },
      { type: "convention", reservedTokens: 1000, weight: 0.7 },
      { type: "test_file", reservedTokens: 800, weight: 0.6 },
    ],
    includeDependencyGraph: true,
    includeStackTraces: false,
    includeConventions: true,
    includeErrorLogs: false,
    includeTestContext: true,
  },
  planning: {
    priorities: [
      { type: "api_definition", reservedTokens: 1500, weight: 0.9 },
      { type: "dependency_graph", reservedTokens: 1200, weight: 0.8 },
      { type: "convention", reservedTokens: 1000, weight: 0.7 },
    ],
    includeDependencyGraph: true,
    includeStackTraces: false,
    includeConventions: true,
    includeErrorLogs: false,
    includeTestContext: false,
  },
  review: {
    priorities: [
      { type: "convention", reservedTokens: 1500, weight: 1.0 },
      { type: "recent_change", reservedTokens: 1200, weight: 0.9 },
      { type: "test_file", reservedTokens: 1000, weight: 0.7 },
    ],
    includeDependencyGraph: false,
    includeStackTraces: false,
    includeConventions: true,
    includeErrorLogs: false,
    includeTestContext: true,
  },
  testing: {
    priorities: [
      { type: "test_file", reservedTokens: 2000, weight: 1.0 },
      { type: "api_definition", reservedTokens: 1200, weight: 0.8 },
      { type: "type_definition", reservedTokens: 1000, weight: 0.7 },
    ],
    includeDependencyGraph: false,
    includeStackTraces: false,
    includeConventions: true,
    includeErrorLogs: false,
    includeTestContext: true,
  },
  documentation: {
    priorities: [
      { type: "convention", reservedTokens: 2000, weight: 1.0 },
      { type: "api_definition", reservedTokens: 1500, weight: 0.9 },
      { type: "type_definition", reservedTokens: 1200, weight: 0.8 },
    ],
    includeDependencyGraph: false,
    includeStackTraces: false,
    includeConventions: true,
    includeErrorLogs: false,
    includeTestContext: false,
  },
  general: {
    priorities: [
      { type: "convention", reservedTokens: 1000, weight: 0.7 },
      { type: "api_definition", reservedTokens: 800, weight: 0.6 },
    ],
    includeDependencyGraph: false,
    includeStackTraces: false,
    includeConventions: true,
    includeErrorLogs: false,
    includeTestContext: false,
  },
};

export interface ContextItem {
  category: "semantic" | "episodic" | "procedural" | "conventions";
  content: string;
  contentType?:
    | "stack_trace"
    | "error_log"
    | "convention"
    | "dependency_graph"
    | "test_file"
    | "recent_change"
    | "api_definition"
    | "type_definition"
    | "general";
  filePath?: string;
  relevanceScore?: number;
  tokenCount: number;
}

export class BudgetOptimizer {
  allocate(taskType: TaskType, totalBudget: number): BudgetAllocation {
    const profile = TASK_PROFILES[taskType] ?? TASK_PROFILES.general;
    const allocation: BudgetAllocation = {
      semantic: Math.floor(totalBudget * profile.semantic),
      episodic: Math.floor(totalBudget * profile.episodic),
      procedural: Math.floor(totalBudget * profile.procedural),
      conventions: Math.floor(totalBudget * profile.conventions),
    };
    const allocated =
      allocation.semantic +
      allocation.episodic +
      allocation.procedural +
      allocation.conventions;
    allocation.semantic += totalBudget - allocated;
    logger.debug(
      { taskType, totalBudget, allocation },
      "Budget allocated for task"
    );
    return allocation;
  }

  allocateDetailed(
    taskType: TaskType,
    totalBudget: number
  ): DetailedBudgetAllocation {
    const base = this.allocate(taskType, totalBudget);
    return {
      ...base,
      taskType,
      totalBudget,
      priorityContent:
        TASK_PRIORITY_CONTENT[taskType] ?? TASK_PRIORITY_CONTENT.general,
    };
  }

  selectContextItems(
    items: ContextItem[],
    taskType: TaskType,
    totalBudget: number
  ): ContextItem[] {
    const allocation = this.allocateDetailed(taskType, totalBudget);
    const priorityConfig = allocation.priorityContent;

    const scored = items.map((item) => ({
      item,
      score: this.scoreItem(item, priorityConfig),
    }));
    scored.sort((a, b) => b.score - a.score);

    const categoryBudgets: Record<string, number> = {
      semantic: allocation.semantic,
      episodic: allocation.episodic,
      procedural: allocation.procedural,
      conventions: allocation.conventions,
    };

    const selected: ContextItem[] = [];
    let totalUsed = 0;

    for (const { item } of scored) {
      if (totalUsed + item.tokenCount > totalBudget) {
        continue;
      }
      const catBudget = categoryBudgets[item.category] ?? 0;
      if (item.tokenCount > catBudget) {
        const isPriority = priorityConfig.priorities.some(
          (p) => p.type === item.contentType
        );
        if (!isPriority || item.tokenCount > catBudget * 1.5) {
          continue;
        }
      }
      categoryBudgets[item.category] =
        (categoryBudgets[item.category] ?? 0) - item.tokenCount;
      totalUsed += item.tokenCount;
      selected.push(item);
    }

    logger.debug(
      {
        taskType,
        totalBudget,
        itemCount: items.length,
        selectedCount: selected.length,
        tokensUsed: totalUsed,
      },
      "Context items selected"
    );
    return selected;
  }

  private scoreItem(
    item: ContextItem,
    priorityConfig: PriorityContentConfig
  ): number {
    let score = item.relevanceScore ?? 0.5;
    for (const priority of priorityConfig.priorities) {
      if (item.contentType === priority.type) {
        score += priority.weight * 0.5;
        break;
      }
    }
    if (
      priorityConfig.includeStackTraces &&
      item.contentType === "stack_trace"
    ) {
      score += 0.3;
    }
    if (
      priorityConfig.includeConventions &&
      item.contentType === "convention"
    ) {
      score += 0.2;
    }
    if (priorityConfig.includeErrorLogs && item.contentType === "error_log") {
      score += 0.25;
    }
    if (
      priorityConfig.includeDependencyGraph &&
      item.contentType === "dependency_graph"
    ) {
      score += 0.2;
    }
    if (priorityConfig.includeTestContext && item.contentType === "test_file") {
      score += 0.15;
    }
    return Math.min(2, score);
  }

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

  classifyContentType(
    content: string,
    filePath?: string
  ): ContextItem["contentType"] {
    const lower = content.toLowerCase();
    if (
      lower.includes("at ") &&
      (lower.includes("error") || lower.includes("exception")) &&
      (lower.includes(".ts:") || lower.includes(".js:"))
    ) {
      return "stack_trace";
    }
    if (
      lower.includes("[error]") ||
      lower.includes("error:") ||
      lower.includes("failed:")
    ) {
      return "error_log";
    }
    if (
      filePath &&
      (filePath.includes(".test.") ||
        filePath.includes(".spec.") ||
        filePath.includes("__tests__"))
    ) {
      return "test_file";
    }
    if (
      filePath &&
      (filePath.includes("config") ||
        filePath.includes("CLAUDE.md") ||
        filePath.includes("conventions"))
    ) {
      return "convention";
    }
    if (
      lower.includes("router") ||
      lower.includes("endpoint") ||
      lower.includes("trpc") ||
      filePath?.includes("api")
    ) {
      return "api_definition";
    }
    if (
      lower.includes("interface ") ||
      lower.includes("type ") ||
      filePath?.includes("types")
    ) {
      return "type_definition";
    }
    return "general";
  }

  private matchesPatterns(text: string, patterns: string[]): boolean {
    return patterns.some((p) => text.includes(p));
  }
}
