/**
 * Prompt Optimizer
 *
 * Manages prompt versioning, optimization, and rollback for agent roles.
 * Uses learned patterns from CorrectionLearner and experiment results
 * to iteratively improve agent prompts.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:training:prompt-optimizer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptVersion {
  agentRole: string;
  content: string;
  createdAt: string;
  id: string;
  metadata: {
    model?: string;
    notes?: string;
    source: "manual" | "optimized" | "rollback";
  };
  performanceScore: number;
  version: number;
}

export interface ExperimentResult {
  agentRole: string;
  completionRate: number;
  correctnessScore: number;
  promptVersionId: string;
  sampleSize: number;
  tokenEfficiency: number;
}

export interface CorrectionInput {
  correctionType: string;
  description: string;
  examples: Array<{ before: string; after: string }>;
}

export interface PromptDiff {
  additions: string[];
  removals: string[];
  versionA: number;
  versionB: number;
}

// ---------------------------------------------------------------------------
// PromptOptimizer
// ---------------------------------------------------------------------------

export class PromptOptimizer {
  private readonly versions: Map<string, PromptVersion[]> = new Map();

  /**
   * Register a base prompt for an agent role.
   * This creates the initial version (v1).
   */
  registerBasePrompt(
    agentRole: string,
    content: string,
    options?: { model?: string; performanceScore?: number }
  ): PromptVersion {
    const version: PromptVersion = {
      id: generateId("pv"),
      agentRole,
      version: 1,
      content,
      performanceScore: options?.performanceScore ?? 0,
      createdAt: new Date().toISOString(),
      metadata: {
        source: "manual",
        model: options?.model,
        notes: "Initial base prompt",
      },
    };

    this.versions.set(agentRole, [version]);

    logger.info({ agentRole, versionId: version.id }, "Base prompt registered");

    return version;
  }

  /**
   * Optimize a prompt using corrections and experiment results.
   * Generates a new version with improvements applied.
   */
  optimizePrompt(
    agentRole: string,
    corrections: CorrectionInput[],
    experimentResults: ExperimentResult[]
  ): PromptVersion {
    const history = this.versions.get(agentRole);
    if (!history || history.length === 0) {
      throw new Error(
        `No prompt versions found for agent role "${agentRole}". Register a base prompt first.`
      );
    }

    const latestVersion = history.at(-1) as PromptVersion;
    let optimizedContent = latestVersion.content;

    // Apply correction-based improvements
    const correctionSection = this.buildCorrectionSection(corrections);
    if (correctionSection) {
      optimizedContent = this.injectSection(
        optimizedContent,
        "LEARNED_CORRECTIONS",
        correctionSection
      );
    }

    // Apply experiment-based improvements
    const experimentSection = this.buildExperimentSection(
      agentRole,
      experimentResults
    );
    if (experimentSection) {
      optimizedContent = this.injectSection(
        optimizedContent,
        "PERFORMANCE_GUIDANCE",
        experimentSection
      );
    }

    // Calculate estimated performance score from experiments
    const relevantExperiments = experimentResults.filter(
      (e) => e.agentRole === agentRole
    );
    const avgScore =
      relevantExperiments.length > 0
        ? relevantExperiments.reduce(
            (sum, e) =>
              sum +
              e.correctnessScore * 0.5 +
              e.completionRate * 0.3 +
              e.tokenEfficiency * 0.2,
            0
          ) / relevantExperiments.length
        : latestVersion.performanceScore;

    const newVersion: PromptVersion = {
      id: generateId("pv"),
      agentRole,
      version: latestVersion.version + 1,
      content: optimizedContent,
      performanceScore: Math.round(avgScore * 100) / 100,
      createdAt: new Date().toISOString(),
      metadata: {
        source: "optimized",
        model: latestVersion.metadata.model,
        notes: `Optimized from v${latestVersion.version} with ${corrections.length} corrections and ${relevantExperiments.length} experiments`,
      },
    };

    history.push(newVersion);

    logger.info(
      {
        agentRole,
        version: newVersion.version,
        performanceScore: newVersion.performanceScore,
        corrections: corrections.length,
        experiments: relevantExperiments.length,
      },
      "Prompt optimized"
    );

    return newVersion;
  }

  /**
   * Rollback a prompt to a specific previous version.
   * Creates a new version with the content of the target version.
   */
  rollbackPrompt(agentRole: string, targetVersion: number): PromptVersion {
    const history = this.versions.get(agentRole);
    if (!history || history.length === 0) {
      throw new Error(
        `No prompt versions found for agent role "${agentRole}".`
      );
    }

    const target = history.find((v) => v.version === targetVersion);
    if (!target) {
      throw new Error(
        `Version ${targetVersion} not found for agent role "${agentRole}". Available versions: ${history.map((v) => v.version).join(", ")}`
      );
    }

    const latest = history.at(-1) as PromptVersion;
    const rolledBack: PromptVersion = {
      id: generateId("pv"),
      agentRole,
      version: latest.version + 1,
      content: target.content,
      performanceScore: target.performanceScore,
      createdAt: new Date().toISOString(),
      metadata: {
        source: "rollback",
        model: target.metadata.model,
        notes: `Rolled back to v${targetVersion}`,
      },
    };

    history.push(rolledBack);

    logger.info(
      {
        agentRole,
        fromVersion: latest.version,
        toVersion: targetVersion,
        newVersion: rolledBack.version,
      },
      "Prompt rolled back"
    );

    return rolledBack;
  }

  /**
   * Get the full version history for an agent role.
   */
  getPromptHistory(agentRole: string): PromptVersion[] {
    return this.versions.get(agentRole) ?? [];
  }

  /**
   * Get the latest prompt version for an agent role.
   */
  getLatestPrompt(agentRole: string): PromptVersion | undefined {
    const history = this.versions.get(agentRole);
    if (!history || history.length === 0) {
      return undefined;
    }
    return history.at(-1);
  }

  /**
   * Compare two prompt versions and return the differences.
   */
  compareVersions(
    agentRole: string,
    versionA: number,
    versionB: number
  ): PromptDiff {
    const history = this.versions.get(agentRole);
    if (!history) {
      throw new Error(
        `No prompt versions found for agent role "${agentRole}".`
      );
    }

    const a = history.find((v) => v.version === versionA);
    const b = history.find((v) => v.version === versionB);

    if (!a) {
      throw new Error(
        `Version ${versionA} not found for agent role "${agentRole}".`
      );
    }
    if (!b) {
      throw new Error(
        `Version ${versionB} not found for agent role "${agentRole}".`
      );
    }

    const linesA = new Set(a.content.split("\n"));
    const linesB = new Set(b.content.split("\n"));

    const additions: string[] = [];
    const removals: string[] = [];

    for (const line of linesB) {
      if (!linesA.has(line) && line.trim() !== "") {
        additions.push(line);
      }
    }

    for (const line of linesA) {
      if (!linesB.has(line) && line.trim() !== "") {
        removals.push(line);
      }
    }

    return { versionA, versionB, additions, removals };
  }

  /**
   * Get all registered agent roles.
   */
  getRegisteredRoles(): string[] {
    return [...this.versions.keys()];
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private buildCorrectionSection(corrections: CorrectionInput[]): string {
    if (corrections.length === 0) {
      return "";
    }

    const lines = [
      "## Learned Corrections",
      "Apply the following learned patterns from user feedback:",
      "",
    ];

    for (const correction of corrections) {
      lines.push(`### ${correction.correctionType}: ${correction.description}`);
      for (const ex of correction.examples.slice(0, 2)) {
        lines.push(`- Before: \`${ex.before.slice(0, 100)}\``);
        lines.push(`  After: \`${ex.after.slice(0, 100)}\``);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  private buildExperimentSection(
    agentRole: string,
    results: ExperimentResult[]
  ): string {
    const relevant = results.filter((r) => r.agentRole === agentRole);
    if (relevant.length === 0) {
      return "";
    }

    const avgCompletion =
      relevant.reduce((s, r) => s + r.completionRate, 0) / relevant.length;
    const avgCorrectness =
      relevant.reduce((s, r) => s + r.correctnessScore, 0) / relevant.length;
    const avgEfficiency =
      relevant.reduce((s, r) => s + r.tokenEfficiency, 0) / relevant.length;

    const lines = [
      "## Performance Guidance",
      `Based on ${relevant.length} experiments:`,
      `- Average completion rate: ${(avgCompletion * 100).toFixed(1)}%`,
      `- Average correctness score: ${(avgCorrectness * 100).toFixed(1)}%`,
      `- Average token efficiency: ${(avgEfficiency * 100).toFixed(1)}%`,
      "",
    ];

    if (avgCompletion < 0.8) {
      lines.push(
        "IMPORTANT: Completion rate is below target. Focus on completing tasks fully before moving on."
      );
    }

    if (avgCorrectness < 0.8) {
      lines.push(
        "IMPORTANT: Correctness is below target. Double-check outputs before finalizing."
      );
    }

    if (avgEfficiency < 0.5) {
      lines.push(
        "IMPORTANT: Token efficiency is low. Be more concise and avoid unnecessary steps."
      );
    }

    return lines.join("\n");
  }

  /**
   * Inject or replace a named section in the prompt content.
   * Sections are delimited by `<!-- BEGIN:NAME -->` and `<!-- END:NAME -->`.
   */
  private injectSection(
    content: string,
    sectionName: string,
    sectionContent: string
  ): string {
    const beginTag = `<!-- BEGIN:${sectionName} -->`;
    const endTag = `<!-- END:${sectionName} -->`;

    const beginIdx = content.indexOf(beginTag);
    const endIdx = content.indexOf(endTag);

    if (beginIdx !== -1 && endIdx !== -1) {
      // Replace existing section
      return `${content.slice(0, beginIdx)}${beginTag}\n${sectionContent}\n${endTag}${content.slice(endIdx + endTag.length)}`;
    }

    // Append new section at the end
    return `${content}\n\n${beginTag}\n${sectionContent}\n${endTag}`;
  }
}
