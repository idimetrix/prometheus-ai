/**
 * Migration Planner — Plans framework migrations, language migrations,
 * and version upgrades with effort estimation and ordered task lists.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("project-brain:migration-planner");

const NON_DIGIT_PREFIX_RE = /^[^0-9]*/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MigrationType = "framework" | "language" | "version";
export type EffortLevel = "low" | "medium" | "high" | "very-high";

export interface MigrationStep {
  blockedBy: string[];
  description: string;
  effort: EffortLevel;
  id: string;
  order: number;
  phase: string;
}

export interface MigrationPlan {
  createdAt: string;
  estimatedEffort: EffortEstimate;
  from: string;
  id: string;
  riskLevel: "low" | "medium" | "high";
  steps: MigrationStep[];
  to: string;
  type: MigrationType;
}

export interface EffortEstimate {
  complexity: EffortLevel;
  developerWeeks: number;
  riskFactors: string[];
}

export interface BreakingChange {
  description: string;
  impact: "low" | "medium" | "high";
  migration: string;
}

// ---------------------------------------------------------------------------
// Known migration paths
// ---------------------------------------------------------------------------

const FRAMEWORK_MIGRATIONS: Record<
  string,
  {
    breakingChanges: BreakingChange[];
    phases: string[];
    riskLevel: MigrationPlan["riskLevel"];
  }
> = {
  "express->hono": {
    riskLevel: "medium",
    phases: [
      "Setup Hono alongside Express",
      "Migrate middleware",
      "Migrate route handlers",
      "Migrate error handling",
      "Update tests",
      "Remove Express dependency",
    ],
    breakingChanges: [
      {
        description: "Request/Response API differs",
        impact: "high",
        migration: "Replace req/res with Hono context (c)",
      },
      {
        description: "Middleware signature changes",
        impact: "medium",
        migration: "Adapt middleware to use Hono middleware pattern",
      },
    ],
  },
  "react->solid": {
    riskLevel: "high",
    phases: [
      "Setup SolidJS build pipeline",
      "Migrate state management (useState -> createSignal)",
      "Migrate effects (useEffect -> createEffect)",
      "Migrate components",
      "Update routing",
      "Update tests",
    ],
    breakingChanges: [
      {
        description: "Reactivity model is fundamentally different",
        impact: "high",
        migration: "Replace React hooks with Solid primitives",
      },
      {
        description: "JSX compilation differs",
        impact: "medium",
        migration: "Update JSX transform configuration",
      },
    ],
  },
  "webpack->vite": {
    riskLevel: "low",
    phases: [
      "Create vite.config.ts",
      "Migrate plugins",
      "Update import paths",
      "Update scripts",
      "Remove webpack config",
    ],
    breakingChanges: [
      {
        description: "Module resolution differences",
        impact: "low",
        migration: "Update import extensions and aliases",
      },
    ],
  },
};

const LANGUAGE_MIGRATIONS: Record<
  string,
  {
    phases: string[];
    riskLevel: MigrationPlan["riskLevel"];
    weeksPer1000Lines: number;
  }
> = {
  "javascript->typescript": {
    riskLevel: "low",
    weeksPer1000Lines: 0.5,
    phases: [
      "Add tsconfig.json and TypeScript dependency",
      "Rename .js files to .ts/.tsx",
      "Add basic types (function parameters, return types)",
      "Fix type errors iteratively",
      "Add strict mode",
      "Add type declarations for untyped dependencies",
    ],
  },
  "commonjs->esm": {
    riskLevel: "medium",
    weeksPer1000Lines: 0.2,
    phases: [
      'Set "type": "module" in package.json',
      "Replace require() with import",
      "Replace module.exports with export",
      "Add file extensions to relative imports",
      "Update test configuration",
      "Update build tools",
    ],
  },
};

// ---------------------------------------------------------------------------
// MigrationPlanner
// ---------------------------------------------------------------------------

export class MigrationPlanner {
  /**
   * Plan a framework migration (e.g., Express to Hono).
   */
  planFrameworkMigration(from: string, to: string): MigrationPlan {
    const key = `${from.toLowerCase()}->${to.toLowerCase()}`;
    logger.info({ from, to }, "Planning framework migration");

    const known = FRAMEWORK_MIGRATIONS[key];
    const phases = known?.phases ?? this.generateGenericPhases(from, to);
    const riskLevel = known?.riskLevel ?? "medium";

    const steps = this.phasesToSteps(phases, "framework");
    const effort = this.estimateEffort({
      type: "framework",
      steps,
      riskLevel,
    });

    return {
      id: generateId("mig"),
      type: "framework",
      from,
      to,
      steps,
      riskLevel,
      estimatedEffort: effort,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Plan a language migration (e.g., JavaScript to TypeScript).
   */
  planLanguageMigration(from: string, to: string): MigrationPlan {
    const key = `${from.toLowerCase()}->${to.toLowerCase()}`;
    logger.info({ from, to }, "Planning language migration");

    const known = LANGUAGE_MIGRATIONS[key];
    const phases = known?.phases ?? this.generateGenericPhases(from, to);
    const riskLevel = known?.riskLevel ?? "medium";

    const steps = this.phasesToSteps(phases, "language");
    const effort = this.estimateEffort({ type: "language", steps, riskLevel });

    return {
      id: generateId("mig"),
      type: "language",
      from,
      to,
      steps,
      riskLevel,
      estimatedEffort: effort,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Plan a version upgrade with breaking change analysis.
   */
  planVersionUpgrade(
    packageName: string,
    fromVersion: string,
    toVersion: string
  ): MigrationPlan {
    logger.info(
      { packageName, fromVersion, toVersion },
      "Planning version upgrade"
    );

    const majorDiff = this.getMajorVersionDiff(fromVersion, toVersion);
    let riskLevel: MigrationPlan["riskLevel"] = "low";
    if (majorDiff >= 2) {
      riskLevel = "high";
    } else if (majorDiff === 1) {
      riskLevel = "medium";
    }

    const phases = [
      `Read ${packageName} changelog for ${fromVersion} to ${toVersion}`,
      "Identify breaking changes affecting current usage",
      `Update ${packageName} to ${toVersion} in package.json`,
      "Fix compilation errors",
      "Update deprecated API calls",
      "Run and fix failing tests",
      "Verify runtime behavior",
    ];

    const steps = this.phasesToSteps(phases, "upgrade");
    const effort = this.estimateEffort({ type: "version", steps, riskLevel });

    return {
      id: generateId("mig"),
      type: "version",
      from: `${packageName}@${fromVersion}`,
      to: `${packageName}@${toVersion}`,
      steps,
      riskLevel,
      estimatedEffort: effort,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Estimate total effort for a migration plan.
   */
  estimateEffort(plan: {
    riskLevel: MigrationPlan["riskLevel"];
    steps: MigrationStep[];
    type: MigrationType;
  }): EffortEstimate {
    const effortWeights: Record<EffortLevel, number> = {
      low: 0.5,
      medium: 1,
      high: 2,
      "very-high": 4,
    };

    const baseWeeks = plan.steps.reduce(
      (sum, step) => sum + effortWeights[step.effort],
      0
    );

    let riskMultiplier = 1.0;
    if (plan.riskLevel === "high") {
      riskMultiplier = 1.5;
    } else if (plan.riskLevel === "medium") {
      riskMultiplier = 1.2;
    }

    const riskFactors: string[] = [];
    if (plan.riskLevel === "high") {
      riskFactors.push("Major architectural changes required");
    }
    if (plan.steps.length > 10) {
      riskFactors.push("Large number of migration steps");
    }
    if (plan.type === "framework") {
      riskFactors.push("Framework migration requires thorough testing");
    }

    let complexity: EffortLevel = "low";
    if (baseWeeks > 8) {
      complexity = "very-high";
    } else if (baseWeeks > 4) {
      complexity = "high";
    } else if (baseWeeks > 2) {
      complexity = "medium";
    }

    return {
      developerWeeks: Math.ceil(baseWeeks * riskMultiplier * 10) / 10,
      complexity,
      riskFactors,
    };
  }

  /**
   * Generate an ordered task list from a migration plan.
   */
  generateMigrationSteps(plan: MigrationPlan): MigrationStep[] {
    return plan.steps;
  }

  // ---- Private helpers ------------------------------------------------------

  private phasesToSteps(
    phases: string[],
    phasePrefix: string
  ): MigrationStep[] {
    return phases.map((phase, index) => ({
      id: generateId("step"),
      order: index + 1,
      phase: `${phasePrefix}-phase-${index + 1}`,
      description: phase,
      effort: this.inferStepEffort(phase),
      blockedBy:
        index > 0
          ? [phases[index - 1]].filter((s): s is string => s != null)
          : [],
    }));
  }

  private inferStepEffort(description: string): EffortLevel {
    const lower = description.toLowerCase();
    if (
      lower.includes("setup") ||
      lower.includes("create") ||
      lower.includes("add")
    ) {
      return "low";
    }
    if (
      lower.includes("migrate") ||
      lower.includes("replace") ||
      lower.includes("update")
    ) {
      return "medium";
    }
    if (lower.includes("fix") || lower.includes("refactor")) {
      return "high";
    }
    return "medium";
  }

  private generateGenericPhases(from: string, to: string): string[] {
    return [
      `Audit current ${from} usage across the project`,
      `Set up ${to} alongside ${from}`,
      `Create compatibility layer between ${from} and ${to}`,
      `Migrate core modules from ${from} to ${to}`,
      "Migrate secondary modules",
      "Update all tests",
      `Remove ${from} dependency`,
      "Final validation and cleanup",
    ];
  }

  private getMajorVersionDiff(from: string, to: string): number {
    const fromMajor = Number.parseInt(
      from.replace(NON_DIGIT_PREFIX_RE, ""),
      10
    );
    const toMajor = Number.parseInt(to.replace(NON_DIGIT_PREFIX_RE, ""), 10);
    if (Number.isNaN(fromMajor) || Number.isNaN(toMajor)) {
      return 1;
    }
    return Math.abs(toMajor - fromMajor);
  }
}
