import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:ci-loop:requirements");

export interface RequirementUpdate {
  criteriaChanges: string[];
  fixDescription: string;
  requirementId: string;
  testsCovered: string[];
  updatedAt: Date;
}

export interface LivingRequirements {
  lastUpdated: Date;
  original: string;
  updates: RequirementUpdate[];
}

/**
 * LivingRequirements tracks how requirements evolve as the CI-Loop
 * fixes issues. After each successful fix, the requirements doc
 * is updated with what was fixed and how criteria changed.
 */
export class LivingRequirementsTracker {
  private readonly requirements = new Map<string, LivingRequirements>();

  /**
   * Initialize with original requirements from discovery phase.
   */
  initialize(projectId: string, srs: string): void {
    this.requirements.set(projectId, {
      original: srs,
      updates: [],
      lastUpdated: new Date(),
    });
    logger.info({ projectId }, "Living requirements initialized");
  }

  /**
   * Record a fix and update the requirements accordingly.
   */
  recordFix(
    projectId: string,
    update: Omit<RequirementUpdate, "updatedAt">
  ): void {
    const req = this.requirements.get(projectId);
    if (!req) {
      logger.warn({ projectId }, "No requirements found to update");
      return;
    }

    req.updates.push({ ...update, updatedAt: new Date() });
    req.lastUpdated = new Date();

    logger.info(
      {
        projectId,
        requirementId: update.requirementId,
        totalUpdates: req.updates.length,
      },
      "Requirements updated after fix"
    );
  }

  /**
   * Get the current state of requirements with all updates applied.
   */
  getCurrentState(projectId: string): LivingRequirements | null {
    return this.requirements.get(projectId) ?? null;
  }

  /**
   * Build a summary of all changes for passing forward through pipeline phases.
   */
  buildChangeSummary(projectId: string): string {
    const req = this.requirements.get(projectId);
    if (!req || req.updates.length === 0) {
      return "No requirement changes recorded.";
    }

    const parts = ["## Requirements Changes (from CI-Loop fixes)\n"];
    for (const update of req.updates) {
      parts.push(`### ${update.requirementId}`);
      parts.push(`- Fix: ${update.fixDescription}`);
      if (update.criteriaChanges.length > 0) {
        parts.push("- Criteria changes:");
        for (const change of update.criteriaChanges) {
          parts.push(`  - ${change}`);
        }
      }
      if (update.testsCovered.length > 0) {
        parts.push(`- Tests: ${update.testsCovered.join(", ")}`);
      }
      parts.push("");
    }

    return parts.join("\n");
  }
}
