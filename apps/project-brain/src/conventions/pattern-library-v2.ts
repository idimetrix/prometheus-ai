/**
 * Phase 6.4 & 6.5: Pattern Library.
 *
 * Stores and retrieves detected code patterns for a project.
 * Provides compliance reporting and JSON export for UI consumption.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:pattern-library-v2");

/** A detected code pattern stored in the library. */
export interface DetectedPattern {
  /** Confidence score 0-1 */
  confidence: number;
  /** Example occurrences */
  examples: string[];
  /** Human-readable pattern name */
  name: string;
  /** Project this pattern belongs to */
  projectId: string;
  /** Tags for categorization */
  tags: string[];
  /** Pattern category */
  type:
    | "anti_pattern"
    | "architectural"
    | "coding_style"
    | "error_handling"
    | "naming"
    | "testing";
}

/** A stored pattern with metadata. */
export interface StoredPattern extends DetectedPattern {
  /** When the pattern was first detected */
  createdAt: string;
  /** Unique pattern ID */
  id: string;
  /** When the pattern was last confirmed */
  updatedAt: string;
}

/** Compliance report for a project. */
export interface ComplianceReport {
  /** Patterns with low confidence (potential issues) */
  lowConfidencePatterns: StoredPattern[];
  /** Overall compliance percentage 0-100 */
  overallScore: number;
  /** Summary of pattern types */
  patternSummary: Record<string, number>;
  /** Project ID */
  projectId: string;
  /** Total patterns detected */
  totalPatterns: number;
}

let patternCounter = 0;

function generatePatternId(): string {
  patternCounter++;
  return `pat_${Date.now()}_${patternCounter}`;
}

/**
 * Stores and manages detected code patterns for projects.
 */
export class PatternLibraryV2 {
  /** In-memory pattern storage: projectId -> pattern[] */
  private readonly patterns = new Map<string, StoredPattern[]>();

  /**
   * Add a new pattern to the library.
   */
  addPattern(pattern: DetectedPattern): StoredPattern {
    const now = new Date().toISOString();
    const stored: StoredPattern = {
      ...pattern,
      id: generatePatternId(),
      createdAt: now,
      updatedAt: now,
    };

    if (!this.patterns.has(pattern.projectId)) {
      this.patterns.set(pattern.projectId, []);
    }
    this.patterns.get(pattern.projectId)?.push(stored);

    logger.info(
      {
        patternId: stored.id,
        projectId: pattern.projectId,
        name: pattern.name,
        type: pattern.type,
      },
      "Pattern added to library"
    );

    return stored;
  }

  /**
   * Retrieve patterns for a project, optionally filtered by type.
   */
  getPatterns(projectId: string, type?: string): StoredPattern[] {
    const projectPatterns = this.patterns.get(projectId) ?? [];

    if (type) {
      return projectPatterns.filter((p) => p.type === type);
    }

    return [...projectPatterns];
  }

  /**
   * Generate a compliance report for a project.
   */
  getComplianceReport(projectId: string): ComplianceReport {
    const projectPatterns = this.patterns.get(projectId) ?? [];

    // Count patterns by type
    const patternSummary: Record<string, number> = {};
    for (const p of projectPatterns) {
      patternSummary[p.type] = (patternSummary[p.type] ?? 0) + 1;
    }

    // Find low confidence patterns
    const lowConfidencePatterns = projectPatterns.filter(
      (p) => p.confidence < 0.5
    );

    // Calculate overall score based on average confidence
    const totalConfidence = projectPatterns.reduce(
      (sum, p) => sum + p.confidence,
      0
    );
    const avgConfidence =
      projectPatterns.length > 0 ? totalConfidence / projectPatterns.length : 1;
    const overallScore = Math.round(avgConfidence * 100);

    const report: ComplianceReport = {
      projectId,
      totalPatterns: projectPatterns.length,
      overallScore,
      patternSummary,
      lowConfidencePatterns,
    };

    logger.info(
      {
        projectId,
        totalPatterns: report.totalPatterns,
        overallScore: report.overallScore,
      },
      "Compliance report generated"
    );

    return report;
  }

  /**
   * Export all patterns for a project as JSON (for UI consumption).
   */
  toJSON(projectId: string): {
    exportedAt: string;
    patterns: StoredPattern[];
    projectId: string;
  } {
    const projectPatterns = this.patterns.get(projectId) ?? [];

    return {
      projectId,
      patterns: [...projectPatterns],
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Remove all patterns for a project.
   */
  clearProject(projectId: string): void {
    this.patterns.delete(projectId);

    logger.info({ projectId }, "Patterns cleared for project");
  }
}
