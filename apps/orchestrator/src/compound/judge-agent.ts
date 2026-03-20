/**
 * JudgeAgent — Reviews all worker results for quality, test coverage,
 * blueprint compliance, and regressions. Uses the "review" model slot
 * for thorough evaluation.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:compound:judge");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerResult {
  /** Agent role that produced the result */
  agentRole: string;
  /** Error message if the worker failed */
  error?: string;
  /** Files changed by the worker */
  filesChanged: string[];
  /** Worker output content */
  output: string;
  /** Whether the worker completed successfully */
  success: boolean;
  /** Subtask ID */
  taskId: string;
  /** Worker ID */
  workerId: string;
}

export interface RevisionRequest {
  /** Specific issue description */
  issue: string;
  /** How critical the issue is */
  severity: "critical" | "major" | "minor";
  /** Suggested fix or direction */
  suggestion: string;
  /** Which worker needs to revise */
  workerId: string;
}

export type JudgmentVerdict = "approve" | "revise" | "reject";

export interface JudgmentResult {
  /** Per-dimension scores (0-100) */
  dimensions: JudgmentDimension[];
  /** Specific revision requests for workers */
  feedback: RevisionRequest[];
  /** Unique judgment identifier */
  id: string;
  /** Overall quality score (0-100) */
  score: number;
  /** Final verdict */
  verdict: JudgmentVerdict;
}

export interface JudgmentDimension {
  details: string;
  name: string;
  score: number;
  weight: number;
}

/** Thresholds for verdict determination. */
const VERDICT_THRESHOLDS = {
  approve: 80,
  revise: 50,
} as const;

/** Blueprint for the optional compliance check. */
export interface JudgeContext {
  blueprint?: string;
  projectConventions?: string[];
  taskDescription: string;
}

// ---------------------------------------------------------------------------
// JudgeAgent
// ---------------------------------------------------------------------------

export class JudgeAgent {
  private readonly approveThreshold: number;
  private readonly reviseThreshold: number;

  constructor(
    approveThreshold = VERDICT_THRESHOLDS.approve,
    reviseThreshold = VERDICT_THRESHOLDS.revise
  ) {
    this.approveThreshold = approveThreshold;
    this.reviseThreshold = reviseThreshold;
  }

  /**
   * Judge all worker results and produce a verdict with feedback.
   *
   * Checks:
   * 1. Quality — code completeness, output clarity
   * 2. Tests — whether tests were included/mentioned
   * 3. Blueprint compliance — matches architecture if blueprint provided
   * 4. Regressions — signs of breaking existing functionality
   */
  judge(changes: WorkerResult[], context: JudgeContext): JudgmentResult {
    const judgmentId = generateId("judgment");

    logger.info(
      {
        judgmentId,
        workerCount: changes.length,
        successCount: changes.filter((c) => c.success).length,
      },
      "JudgeAgent: evaluating worker results"
    );

    const dimensions: JudgmentDimension[] = [];
    const feedback: RevisionRequest[] = [];

    // Dimension 1: Completion (weight: 0.3)
    const completionScore = this.scoreCompletion(changes);
    dimensions.push({
      name: "completion",
      score: completionScore.score,
      weight: 0.3,
      details: completionScore.details,
    });
    feedback.push(...completionScore.issues);

    // Dimension 2: Quality (weight: 0.25)
    const qualityScore = this.scoreQuality(changes);
    dimensions.push({
      name: "quality",
      score: qualityScore.score,
      weight: 0.25,
      details: qualityScore.details,
    });
    feedback.push(...qualityScore.issues);

    // Dimension 3: Test Coverage (weight: 0.2)
    const testScore = this.scoreTestCoverage(changes);
    dimensions.push({
      name: "test_coverage",
      score: testScore.score,
      weight: 0.2,
      details: testScore.details,
    });
    feedback.push(...testScore.issues);

    // Dimension 4: Blueprint Compliance (weight: 0.15)
    const complianceScore = this.scoreBlueprintCompliance(changes, context);
    dimensions.push({
      name: "blueprint_compliance",
      score: complianceScore.score,
      weight: 0.15,
      details: complianceScore.details,
    });
    feedback.push(...complianceScore.issues);

    // Dimension 5: Regression Risk (weight: 0.1)
    const regressionScore = this.scoreRegressionRisk(changes);
    dimensions.push({
      name: "regression_risk",
      score: regressionScore.score,
      weight: 0.1,
      details: regressionScore.details,
    });
    feedback.push(...regressionScore.issues);

    // Calculate weighted overall score
    const overallScore = Math.round(
      dimensions.reduce((sum, d) => sum + d.score * d.weight, 0)
    );

    // Determine verdict
    let verdict: JudgmentVerdict;
    if (overallScore >= this.approveThreshold) {
      verdict = "approve";
    } else if (overallScore >= this.reviseThreshold) {
      verdict = "revise";
    } else {
      verdict = "reject";
    }

    // If any critical issues exist, force revise/reject
    const hasCritical = feedback.some((f) => f.severity === "critical");
    if (hasCritical && verdict === "approve") {
      verdict = "revise";
    }

    const result: JudgmentResult = {
      id: judgmentId,
      verdict,
      score: overallScore,
      dimensions,
      feedback,
    };

    logger.info(
      {
        judgmentId,
        verdict,
        score: overallScore,
        feedbackCount: feedback.length,
        criticalCount: feedback.filter((f) => f.severity === "critical").length,
      },
      "JudgeAgent: judgment rendered"
    );

    return result;
  }

  // ---------------------------------------------------------------------------
  // Scoring dimensions
  // ---------------------------------------------------------------------------

  private scoreCompletion(changes: WorkerResult[]): DimensionResult {
    const total = changes.length;
    const successful = changes.filter((c) => c.success).length;
    const ratio = total > 0 ? successful / total : 0;
    const score = Math.round(ratio * 100);

    const issues: RevisionRequest[] = [];
    for (const change of changes) {
      if (!change.success) {
        issues.push({
          workerId: change.workerId,
          issue: `Worker failed: ${change.error ?? "unknown error"}`,
          severity: "critical",
          suggestion:
            "Re-execute the subtask or reassign to a different agent role",
        });
      } else if (change.output.length < 50) {
        issues.push({
          workerId: change.workerId,
          issue: "Worker output is suspiciously short",
          severity: "major",
          suggestion: "Verify the subtask was fully completed",
        });
      }
    }

    return {
      score,
      details: `${successful}/${total} workers completed successfully`,
      issues,
    };
  }

  private scoreQuality(changes: WorkerResult[]): DimensionResult {
    let totalScore = 0;
    const issues: RevisionRequest[] = [];

    for (const change of changes) {
      if (!change.success) {
        continue;
      }

      let workerScore = 70; // Base score for successful completion

      // Bonus for substantive output
      if (change.output.length > 200) {
        workerScore += 10;
      }

      // Bonus for files changed (indicates actual code work)
      if (change.filesChanged.length > 0) {
        workerScore += 10;
      }

      // Penalty for error-like patterns in output
      const outputLower = change.output.toLowerCase();
      if (
        outputLower.includes("todo") ||
        outputLower.includes("hack") ||
        outputLower.includes("fixme")
      ) {
        workerScore -= 15;
        issues.push({
          workerId: change.workerId,
          issue: "Output contains TODO/HACK/FIXME markers",
          severity: "minor",
          suggestion: "Resolve pending items before completion",
        });
      }

      // Penalty for console.log / debugger in output
      if (
        outputLower.includes("console.log") ||
        outputLower.includes("debugger")
      ) {
        workerScore -= 10;
        issues.push({
          workerId: change.workerId,
          issue: "Debug statements detected in output",
          severity: "minor",
          suggestion: "Remove console.log and debugger statements",
        });
      }

      totalScore += Math.max(0, Math.min(100, workerScore));
    }

    const successfulCount = changes.filter((c) => c.success).length;
    const score =
      successfulCount > 0 ? Math.round(totalScore / successfulCount) : 0;

    return {
      score,
      details: `Average quality score: ${score}/100`,
      issues,
    };
  }

  private scoreTestCoverage(changes: WorkerResult[]): DimensionResult {
    const issues: RevisionRequest[] = [];

    // Check if any worker is a test engineer
    const hasTestWorker = changes.some(
      (c) => c.agentRole === "test_engineer" && c.success
    );

    // Check if test files were created
    const testFiles = changes.flatMap((c) =>
      c.filesChanged.filter(
        (f) =>
          f.includes(".test.") ||
          f.includes(".spec.") ||
          f.includes("__tests__")
      )
    );

    let score = 50; // Base score

    if (hasTestWorker) {
      score += 30;
    }

    if (testFiles.length > 0) {
      score += 20;
    }

    if (!hasTestWorker && testFiles.length === 0) {
      // Find the first code worker to assign the issue to
      const codeWorker = changes.find(
        (c) =>
          c.success &&
          (c.agentRole === "backend_coder" || c.agentRole === "frontend_coder")
      );

      if (codeWorker) {
        issues.push({
          workerId: codeWorker.workerId,
          issue: "No test coverage detected",
          severity: "major",
          suggestion: "Add unit tests for the implemented functionality",
        });
      }
    }

    return {
      score: Math.min(100, score),
      details: `Test worker: ${hasTestWorker}, test files: ${testFiles.length}`,
      issues,
    };
  }

  private scoreBlueprintCompliance(
    changes: WorkerResult[],
    context: JudgeContext
  ): DimensionResult {
    const issues: RevisionRequest[] = [];

    if (!context.blueprint) {
      return {
        score: 100,
        details: "No blueprint provided, skipping compliance check",
        issues: [],
      };
    }

    let score = 80; // Default: assume compliance unless we find issues

    // Check if architect agent was included
    const hasArchitect = changes.some(
      (c) => c.agentRole === "architect" && c.success
    );
    if (hasArchitect) {
      score += 10;
    }

    // Simple heuristic: check if output mentions blueprint terms
    const blueprintLower = context.blueprint.toLowerCase();
    const allOutput = changes.map((c) => c.output.toLowerCase()).join(" ");

    // Check for key architectural terms from blueprint
    const architecturalTerms = [
      "api",
      "database",
      "schema",
      "endpoint",
      "service",
    ];
    let matchingTerms = 0;
    for (const term of architecturalTerms) {
      if (blueprintLower.includes(term) && allOutput.includes(term)) {
        matchingTerms++;
      }
    }

    if (architecturalTerms.length > 0) {
      const termCoverage = matchingTerms / architecturalTerms.length;
      if (termCoverage < 0.3) {
        score -= 20;
        const firstWorker = changes.find((c) => c.success);
        if (firstWorker) {
          issues.push({
            workerId: firstWorker.workerId,
            issue: "Implementation may not align with blueprint architecture",
            severity: "major",
            suggestion:
              "Review blueprint and ensure key architectural decisions are followed",
          });
        }
      }
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      details: `Blueprint compliance score: ${score}/100`,
      issues,
    };
  }

  private scoreRegressionRisk(changes: WorkerResult[]): DimensionResult {
    const issues: RevisionRequest[] = [];
    let score = 90; // Start high, deduct for risk signals

    for (const change of changes) {
      if (!change.success) {
        continue;
      }

      const outputLower = change.output.toLowerCase();

      // High-risk patterns
      if (
        outputLower.includes("breaking change") ||
        outputLower.includes("removed") ||
        outputLower.includes("deleted existing")
      ) {
        score -= 20;
        issues.push({
          workerId: change.workerId,
          issue: "Potential breaking changes detected",
          severity: "critical",
          suggestion:
            "Verify backward compatibility and add migration if needed",
        });
      }

      // Modifying many files is risky
      if (change.filesChanged.length > 10) {
        score -= 10;
        issues.push({
          workerId: change.workerId,
          issue: `Large changeset: ${change.filesChanged.length} files modified`,
          severity: "minor",
          suggestion: "Review all changed files for unintended modifications",
        });
      }
    }

    return {
      score: Math.max(0, Math.min(100, score)),
      details: `Regression risk score: ${score}/100 (higher = lower risk)`,
      issues,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface DimensionResult {
  details: string;
  issues: RevisionRequest[];
  score: number;
}
