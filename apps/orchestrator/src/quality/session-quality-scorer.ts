/**
 * Phase 5.12: Session Quality Scoring.
 *
 * Evaluates the quality of an agent session across multiple dimensions:
 *  - Code compiles (typecheck pass/fail)
 *  - Tests pass
 *  - Follows project conventions
 *  - Output completeness
 *  - Error count
 *
 * Publishes a quality report to session events for dashboard display.
 */
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";

const logger = createLogger("orchestrator:quality:session-scorer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualityDimension {
  /** Human-readable details */
  details: string;
  /** Dimension name */
  name: string;
  /** Pass/fail for binary dimensions */
  passed: boolean;
  /** Score 0-1 */
  score: number;
  /** Weight in overall score */
  weight: number;
}

export interface SessionQualityReport {
  /** Individual dimension scores */
  dimensions: QualityDimension[];
  /** Quality grade (A-F) */
  grade: string;
  /** Overall quality score (0-1) */
  overallScore: number;
  /** Session ID */
  sessionId: string;
  /** Suggestions for improvement */
  suggestions: string[];
  /** Summary text */
  summary: string;
  /** Timestamp */
  timestamp: string;
}

export interface SessionQualityInput {
  /** Code coverage percentage (0-100) if available */
  codeCoverage?: number;
  /** Convention violations found */
  conventionViolations: number;
  /** Files changed */
  filesChanged: number;
  /** Whether output follows convention patterns */
  followsConventions: boolean;
  /** Number of lint errors */
  lintErrors: number;
  /** Number of lint warnings */
  lintWarnings: number;
  sessionId: string;
  /** Whether the task was completed (agent reported success) */
  taskCompleted: boolean;
  /** Number of test failures */
  testFailures: number;
  /** Whether tests passed */
  testsPassed: boolean;
  /** Number of tool call errors during execution */
  toolErrors: number;
  /** Total tests run */
  totalTests: number;
  /** Total tool calls */
  totalToolCalls: number;
  /** Whether TypeScript compilation succeeded */
  typecheckPassed: boolean;
  /** Number of type errors */
  typeErrors: number;
}

// ---------------------------------------------------------------------------
// Session Quality Scorer
// ---------------------------------------------------------------------------

export class SessionQualityScorer {
  private readonly eventPublisher: EventPublisher;

  constructor() {
    this.eventPublisher = new EventPublisher();
  }

  /**
   * Score a session and return the quality report.
   */
  score(input: SessionQualityInput): SessionQualityReport {
    const dimensions: QualityDimension[] = [];
    const suggestions: string[] = [];

    // 1. Compilation (weight: 0.25)
    const compilationScore = input.typecheckPassed
      ? 1.0
      : Math.max(0, 1 - input.typeErrors * 0.1);
    dimensions.push({
      name: "compilation",
      score: compilationScore,
      weight: 0.25,
      details: input.typecheckPassed
        ? "TypeScript compilation passed"
        : `${input.typeErrors} type error(s)`,
      passed: input.typecheckPassed,
    });
    if (!input.typecheckPassed) {
      suggestions.push(
        `Fix ${input.typeErrors} TypeScript error(s) to ensure compilation`
      );
    }

    // 2. Tests (weight: 0.25)
    let testScore = 0.5; // No tests = neutral
    if (input.totalTests > 0) {
      testScore = input.testsPassed
        ? 1.0
        : Math.max(
            0,
            (input.totalTests - input.testFailures) / input.totalTests
          );
    }
    dimensions.push({
      name: "tests",
      score: testScore,
      weight: 0.25,
      details:
        input.totalTests > 0
          ? `${input.totalTests - input.testFailures}/${input.totalTests} tests passed`
          : "No tests executed",
      passed: input.testsPassed || input.totalTests === 0,
    });
    if (input.testFailures > 0) {
      suggestions.push(`Fix ${input.testFailures} failing test(s)`);
    }
    if (input.totalTests === 0) {
      suggestions.push("Consider adding tests for the changed code");
    }

    // 3. Conventions (weight: 0.15)
    const conventionScore = input.followsConventions
      ? 1.0
      : Math.max(0, 1 - input.conventionViolations * 0.15);
    dimensions.push({
      name: "conventions",
      score: conventionScore,
      weight: 0.15,
      details: input.followsConventions
        ? "Follows project conventions"
        : `${input.conventionViolations} convention violation(s)`,
      passed: input.followsConventions,
    });
    if (!input.followsConventions) {
      suggestions.push(
        `Address ${input.conventionViolations} convention violation(s)`
      );
    }

    // 4. Lint quality (weight: 0.10)
    let lintScore = 1.0;
    if (input.lintErrors > 0) {
      lintScore = Math.max(0, 1 - input.lintErrors * 0.2);
    } else if (input.lintWarnings > 5) {
      lintScore = Math.max(0.5, 1 - input.lintWarnings * 0.05);
    }
    dimensions.push({
      name: "lint",
      score: lintScore,
      weight: 0.1,
      details: `${input.lintErrors} error(s), ${input.lintWarnings} warning(s)`,
      passed: input.lintErrors === 0,
    });
    if (input.lintErrors > 0) {
      suggestions.push(`Fix ${input.lintErrors} lint error(s)`);
    }

    // 5. Task completion (weight: 0.15)
    const completionScore = input.taskCompleted ? 1.0 : 0.0;
    dimensions.push({
      name: "completion",
      score: completionScore,
      weight: 0.15,
      details: input.taskCompleted
        ? "Task completed successfully"
        : "Task not completed",
      passed: input.taskCompleted,
    });

    // 6. Tool reliability (weight: 0.10)
    const toolScore =
      input.totalToolCalls > 0
        ? (input.totalToolCalls - input.toolErrors) / input.totalToolCalls
        : 1.0;
    dimensions.push({
      name: "toolReliability",
      score: toolScore,
      weight: 0.1,
      details:
        input.totalToolCalls > 0
          ? `${input.totalToolCalls - input.toolErrors}/${input.totalToolCalls} tool calls succeeded`
          : "No tool calls",
      passed: input.toolErrors === 0,
    });

    // Calculate overall weighted score
    const overallScore = dimensions.reduce(
      (sum, d) => sum + d.score * d.weight,
      0
    );
    const grade = this.scoreToGrade(overallScore);

    const summary = [
      `Session quality: ${grade} (${(overallScore * 100).toFixed(0)}%)`,
      dimensions
        .filter((d) => !d.passed)
        .map((d) => `- ${d.name}: ${d.details}`)
        .join("\n"),
    ]
      .filter(Boolean)
      .join("\n");

    const report: SessionQualityReport = {
      sessionId: input.sessionId,
      overallScore,
      grade,
      dimensions,
      summary,
      suggestions,
      timestamp: new Date().toISOString(),
    };

    logger.info(
      {
        sessionId: input.sessionId,
        overallScore: overallScore.toFixed(3),
        grade,
        dimensionCount: dimensions.length,
      },
      "Session quality scored"
    );

    return report;
  }

  /**
   * Score a session and publish the quality report as a session event.
   */
  async scoreAndPublish(
    input: SessionQualityInput
  ): Promise<SessionQualityReport> {
    const report = this.score(input);

    await this.eventPublisher.publishSessionEvent(input.sessionId, {
      type: QueueEvents.AGENT_STATUS,
      data: { qualityReport: report },
      timestamp: report.timestamp,
    });

    logger.info(
      { sessionId: input.sessionId, grade: report.grade },
      "Quality report published to session events"
    );

    return report;
  }

  /**
   * Convert a 0-1 score to a letter grade.
   */
  private scoreToGrade(score: number): string {
    if (score >= 0.9) {
      return "A";
    }
    if (score >= 0.8) {
      return "B";
    }
    if (score >= 0.7) {
      return "C";
    }
    if (score >= 0.6) {
      return "D";
    }
    return "F";
  }
}
