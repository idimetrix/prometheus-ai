import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:smart-budget");

export interface BudgetAllocation {
  architecture: number;
  buffer: number;
  dependencies: number;
  memory: number;
  taskCode: number;
  tests: number;
  total: number;
}

export interface BudgetConfig {
  agentRole: string;
  hasBlueprint: boolean;
  hasTestFiles: boolean;
  maxTokens: number;
  relevantFileCount: number;
  taskType?: string;
}

interface BudgetProfile {
  architecture: number;
  buffer: number;
  dependencies: number;
  memory: number;
  taskCode: number;
  tests: number;
}

/** Role-specific budget profiles as fractional allocations (must sum to 1.0) */
const ROLE_BUDGETS: Record<string, BudgetProfile> = {
  backend_coder: {
    taskCode: 0.35,
    architecture: 0.15,
    memory: 0.15,
    dependencies: 0.15,
    tests: 0.1,
    buffer: 0.1,
  },
  frontend_coder: {
    taskCode: 0.4,
    architecture: 0.1,
    memory: 0.1,
    dependencies: 0.15,
    tests: 0.1,
    buffer: 0.15,
  },
  architect: {
    taskCode: 0.2,
    architecture: 0.3,
    memory: 0.15,
    dependencies: 0.2,
    tests: 0.05,
    buffer: 0.1,
  },
  test_engineer: {
    taskCode: 0.3,
    architecture: 0.05,
    memory: 0.15,
    dependencies: 0.1,
    tests: 0.3,
    buffer: 0.1,
  },
  security_auditor: {
    taskCode: 0.4,
    architecture: 0.15,
    memory: 0.1,
    dependencies: 0.2,
    tests: 0.05,
    buffer: 0.1,
  },
  ci_loop: {
    taskCode: 0.3,
    architecture: 0.05,
    memory: 0.2,
    dependencies: 0.15,
    tests: 0.2,
    buffer: 0.1,
  },
  deploy_engineer: {
    taskCode: 0.25,
    architecture: 0.2,
    memory: 0.15,
    dependencies: 0.15,
    tests: 0.1,
    buffer: 0.15,
  },
  default: {
    taskCode: 0.3,
    architecture: 0.15,
    memory: 0.15,
    dependencies: 0.15,
    tests: 0.1,
    buffer: 0.15,
  },
};

/** Categories ordered by eviction priority (least critical first) */
const EVICTION_PRIORITY: readonly string[] = [
  "buffer",
  "memory",
  "architecture",
  "tests",
  "dependencies",
  "taskCode",
];

export class SmartBudgetAllocator {
  /**
   * Allocate token budget across context categories based on agent role,
   * task type, and available signals (blueprint, test files, file count).
   */
  allocate(config: BudgetConfig): BudgetAllocation {
    const {
      maxTokens,
      agentRole,
      hasBlueprint,
      hasTestFiles,
      relevantFileCount,
    } = config;

    const profile = this.getProfile(agentRole);
    const adjusted = this.adjustForContext(
      profile,
      hasBlueprint,
      hasTestFiles,
      relevantFileCount
    );

    const allocation: BudgetAllocation = {
      taskCode: Math.floor(maxTokens * adjusted.taskCode),
      architecture: Math.floor(maxTokens * adjusted.architecture),
      memory: Math.floor(maxTokens * adjusted.memory),
      dependencies: Math.floor(maxTokens * adjusted.dependencies),
      tests: Math.floor(maxTokens * adjusted.tests),
      buffer: Math.floor(maxTokens * adjusted.buffer),
      total: maxTokens,
    };

    // Distribute any rounding remainder into taskCode
    const allocated =
      allocation.taskCode +
      allocation.architecture +
      allocation.memory +
      allocation.dependencies +
      allocation.tests +
      allocation.buffer;
    const remainder = maxTokens - allocated;
    allocation.taskCode += remainder;

    logger.info(
      {
        agentRole,
        maxTokens,
        hasBlueprint,
        hasTestFiles,
        relevantFileCount,
        allocation,
      },
      "Budget allocated"
    );

    return allocation;
  }

  /**
   * Suggest context categories to evict from when usage exceeds budget.
   * Returns categories sorted by eviction priority (least recently referenced first).
   */
  suggestEviction(
    currentUsage: Record<string, number>,
    budget: BudgetAllocation
  ): string[] {
    const overBudget: Array<{ category: string; overage: number }> = [];
    const budgetMap: Record<string, number> = {
      taskCode: budget.taskCode,
      architecture: budget.architecture,
      memory: budget.memory,
      dependencies: budget.dependencies,
      tests: budget.tests,
      buffer: budget.buffer,
    };

    for (const [category, usage] of Object.entries(currentUsage)) {
      const limit = budgetMap[category];
      if (limit !== undefined && usage > limit) {
        overBudget.push({ category, overage: usage - limit });
      }
    }

    if (overBudget.length === 0) {
      return [];
    }

    // Sort by eviction priority order
    const priorityIndex = new Map(
      EVICTION_PRIORITY.map((cat, idx) => [cat, idx])
    );

    const evictionList = overBudget
      .sort((a, b) => {
        const aPriority =
          priorityIndex.get(a.category) ?? EVICTION_PRIORITY.length;
        const bPriority =
          priorityIndex.get(b.category) ?? EVICTION_PRIORITY.length;
        return aPriority - bPriority;
      })
      .map((entry) => entry.category);

    logger.info({ evictionList, overBudget }, "Eviction candidates identified");

    return evictionList;
  }

  private getProfile(agentRole: string): BudgetProfile {
    const DEFAULT_PROFILE: BudgetProfile = {
      taskCode: 0.3,
      architecture: 0.15,
      memory: 0.15,
      dependencies: 0.15,
      tests: 0.1,
      buffer: 0.15,
    };
    return ROLE_BUDGETS[agentRole] ?? DEFAULT_PROFILE;
  }

  /**
   * Adjust budget profile based on available context signals.
   * - No blueprint: redistribute architecture tokens to taskCode and dependencies
   * - No test files: redistribute test tokens to taskCode and memory
   * - Many relevant files: boost dependencies allocation from buffer
   */
  private adjustForContext(
    profile: BudgetProfile,
    hasBlueprint: boolean,
    hasTestFiles: boolean,
    relevantFileCount: number
  ): BudgetProfile {
    const adjusted = { ...profile };

    if (!hasBlueprint) {
      const redistributed = adjusted.architecture * 0.6;
      adjusted.taskCode += redistributed * 0.6;
      adjusted.dependencies += redistributed * 0.4;
      adjusted.architecture *= 0.4;
    }

    if (!hasTestFiles) {
      const redistributed = adjusted.tests * 0.7;
      adjusted.taskCode += redistributed * 0.6;
      adjusted.memory += redistributed * 0.4;
      adjusted.tests *= 0.3;
    }

    // For large file sets, shift some buffer into dependencies
    if (relevantFileCount > 20) {
      const shift = adjusted.buffer * 0.3;
      adjusted.dependencies += shift;
      adjusted.buffer -= shift;
    }

    // Normalize to ensure fractions sum to 1.0
    const sum =
      adjusted.taskCode +
      adjusted.architecture +
      adjusted.memory +
      adjusted.dependencies +
      adjusted.tests +
      adjusted.buffer;

    if (sum > 0) {
      adjusted.taskCode /= sum;
      adjusted.architecture /= sum;
      adjusted.memory /= sum;
      adjusted.dependencies /= sum;
      adjusted.tests /= sum;
      adjusted.buffer /= sum;
    }

    return adjusted;
  }
}
