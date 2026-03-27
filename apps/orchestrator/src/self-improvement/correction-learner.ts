import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:correction-learner");

export interface CodeCorrection {
  correctedCode: string;
  correctionType:
    | "style"
    | "logic"
    | "performance"
    | "security"
    | "naming"
    | "structure";
  filePath: string;
  id: string;
  language: string;
  originalCode: string;
  projectId: string;
  timestamp: Date;
  userId: string;
}

export interface LearnedPattern {
  appliesTo: string; // language or file pattern
  confidence: number;
  description: string;
  examples: Array<{ before: string; after: string }>;
  id: string;
  rule: string;
  type: string;
}

/**
 * Learns from user corrections to agent output.
 * Extracts patterns from before/after code pairs and stores them
 * for injection into future agent prompts.
 */
export class CorrectionLearner {
  private readonly corrections: CodeCorrection[] = [];
  private readonly patterns: Map<string, LearnedPattern> = new Map();

  recordCorrection(correction: CodeCorrection): void {
    this.corrections.push(correction);
    logger.info(
      {
        correctionId: correction.id,
        type: correction.correctionType,
        filePath: correction.filePath,
      },
      "Correction recorded"
    );
    this.extractPatterns(correction);
  }

  private extractPatterns(correction: CodeCorrection): void {
    // Simple heuristic: if the correction is a naming change
    if (correction.correctionType === "naming") {
      const pattern: LearnedPattern = {
        id: `pat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: "naming",
        rule: "Prefer the naming convention used in the correction",
        description: `User corrected naming in ${correction.filePath}`,
        appliesTo: correction.language,
        confidence: 0.7,
        examples: [
          {
            before: correction.originalCode.slice(0, 200),
            after: correction.correctedCode.slice(0, 200),
          },
        ],
      };
      this.patterns.set(pattern.id, pattern);
    }

    // Style correction pattern
    if (correction.correctionType === "style") {
      const pattern: LearnedPattern = {
        id: `pat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: "style",
        rule: "Follow the code style shown in the correction",
        description: `User corrected code style in ${correction.filePath}`,
        appliesTo: correction.language,
        confidence: 0.8,
        examples: [
          {
            before: correction.originalCode.slice(0, 200),
            after: correction.correctedCode.slice(0, 200),
          },
        ],
      };
      this.patterns.set(pattern.id, pattern);
    }

    // Generic pattern for other types
    if (!["naming", "style"].includes(correction.correctionType)) {
      const pattern: LearnedPattern = {
        id: `pat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: correction.correctionType,
        rule: `Apply the ${correction.correctionType} improvement shown in the correction`,
        description: `User made a ${correction.correctionType} correction in ${correction.filePath}`,
        appliesTo: correction.language,
        confidence: 0.6,
        examples: [
          {
            before: correction.originalCode.slice(0, 200),
            after: correction.correctedCode.slice(0, 200),
          },
        ],
      };
      this.patterns.set(pattern.id, pattern);
    }

    logger.info(
      {
        totalPatterns: this.patterns.size,
        correctionType: correction.correctionType,
      },
      "Pattern extracted from correction"
    );
  }

  /**
   * Get learned patterns relevant to a specific language/file to inject into agent prompts.
   */
  getPatternsForContext(
    language: string,
    _projectId?: string
  ): LearnedPattern[] {
    const patterns: LearnedPattern[] = [];
    for (const pattern of this.patterns.values()) {
      if (pattern.appliesTo === language || pattern.appliesTo === "*") {
        patterns.push(pattern);
      }
    }
    // Sort by confidence descending
    return patterns.sort((a, b) => b.confidence - a.confidence).slice(0, 10);
  }

  /**
   * Generate a prompt section with learned corrections.
   */
  generatePromptContext(language: string, projectId?: string): string {
    const patterns = this.getPatternsForContext(language, projectId);
    if (patterns.length === 0) {
      return "";
    }

    const lines = [
      "## Previously Learned Corrections",
      "The user has previously corrected the following patterns. Apply these learnings:",
      "",
    ];

    for (const pattern of patterns) {
      lines.push(`- **${pattern.type}**: ${pattern.rule}`);
      if (pattern.examples.length > 0) {
        const ex = pattern.examples[0];
        if (ex) {
          lines.push(`  Before: \`${ex.before.slice(0, 80)}\``);
          lines.push(`  After: \`${ex.after.slice(0, 80)}\``);
        }
      }
    }

    return lines.join("\n");
  }

  getStats(): {
    correctionCount: number;
    patternCount: number;
    byType: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    for (const c of this.corrections) {
      byType[c.correctionType] = (byType[c.correctionType] ?? 0) + 1;
    }
    return {
      correctionCount: this.corrections.length,
      patternCount: this.patterns.size,
      byType,
    };
  }
}
