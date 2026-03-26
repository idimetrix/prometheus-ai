/**
 * Self-Improving Agent (MOON-002)
 *
 * Agents that learn from their own execution history. Analyzes past
 * sessions to identify successes, failures, and inefficiencies, then
 * generates and applies prompt/tool/workflow improvements automatically.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:training:self-improvement");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecutionAnalysis {
  efficiency: {
    tokensWasted: number;
    unnecessarySteps: number;
    optimalPath: string[];
  };
  failures: Array<{
    action: string;
    avoidanceStrategy: string;
    error: string;
    rootCause: string;
  }>;
  successes: Array<{
    action: string;
    outcome: string;
    pattern: string;
  }>;
}

export interface ImprovementSet {
  promptImprovements: Array<{
    improvement: string;
    reasoning: string;
    role: string;
  }>;
  toolUsagePatterns: Array<{
    pattern: string;
    recommendation: string;
  }>;
  workflowOptimizations: Array<{
    current: string;
    savings: string;
    suggested: string;
  }>;
}

export interface ApplyResult {
  applied: number;
  results: Array<{
    improvement: string;
    reason?: string;
    status: "applied" | "skipped";
  }>;
  skipped: number;
}

interface SessionRecord {
  actions: Array<{
    durationMs: number;
    result: "success" | "error" | "timeout";
    resultSummary: string;
    tool: string;
    tokensUsed: number;
  }>;
  id: string;
  outcome: "success" | "failure" | "partial";
  projectId: string;
  sessionId: string;
  timestamp: string;
}

interface StoredImprovement {
  appliedAt?: string;
  category: "prompt" | "tool_usage" | "workflow";
  description: string;
  id: string;
  projectId: string;
  status: "pending" | "applied" | "skipped";
}

// ---------------------------------------------------------------------------
// SelfImprovingAgent
// ---------------------------------------------------------------------------

export class SelfImprovingAgent {
  private readonly sessions: SessionRecord[] = [];
  private readonly improvements = new Map<string, StoredImprovement[]>();

  /**
   * Record a completed session for later analysis.
   */
  recordSession(
    sessionId: string,
    projectId: string,
    outcome: SessionRecord["outcome"],
    actions: SessionRecord["actions"]
  ): void {
    const record: SessionRecord = {
      id: generateId("sir"),
      sessionId,
      projectId,
      outcome,
      actions,
      timestamp: new Date().toISOString(),
    };
    this.sessions.push(record);
    logger.info(
      { sessionId, outcome, actionCount: actions.length },
      "Recorded session for self-improvement analysis"
    );
  }

  /**
   * Analyze a specific session to extract successes, failures, and
   * efficiency metrics.
   */
  analyzeExecution(sessionId: string): ExecutionAnalysis {
    const session = this.sessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      logger.warn({ sessionId }, "Session not found for analysis");
      return {
        successes: [],
        failures: [],
        efficiency: { tokensWasted: 0, unnecessarySteps: 0, optimalPath: [] },
      };
    }

    const successes: ExecutionAnalysis["successes"] = [];
    const failures: ExecutionAnalysis["failures"] = [];
    let tokensWasted = 0;
    let unnecessarySteps = 0;
    const optimalPath: string[] = [];

    // Analyze each action in sequence
    for (let i = 0; i < session.actions.length; i++) {
      const action = session.actions[i];
      if (!action) {
        continue;
      }

      if (action.result === "success") {
        // Detect the pattern from successful actions
        const pattern = this.detectActionPattern(session.actions, i);
        successes.push({
          action: action.tool,
          outcome: action.resultSummary,
          pattern,
        });
        optimalPath.push(action.tool);
      } else if (action.result === "error") {
        // Analyze failure and determine avoidance strategy
        const rootCause = this.inferRootCause(action);
        const avoidanceStrategy = this.suggestAvoidance(rootCause, action.tool);

        failures.push({
          action: action.tool,
          error: action.resultSummary,
          rootCause,
          avoidanceStrategy,
        });
        tokensWasted += action.tokensUsed;
        unnecessarySteps += 1;
      } else {
        // Timeout — usually a wasted step
        tokensWasted += action.tokensUsed;
        unnecessarySteps += 1;
      }
    }

    // Check for repeated tool calls (sign of inefficiency)
    const toolCounts = new Map<string, number>();
    for (const action of session.actions) {
      toolCounts.set(action.tool, (toolCounts.get(action.tool) ?? 0) + 1);
    }
    for (const [tool, count] of toolCounts) {
      if (count > 3) {
        unnecessarySteps += count - 3;
      }
      // Still include repeated tools in the optimal path if they succeeded
      if (!optimalPath.includes(tool)) {
        const hadSuccess = session.actions.some(
          (a) => a.tool === tool && a.result === "success"
        );
        if (hadSuccess) {
          optimalPath.push(tool);
        }
      }
    }

    logger.info(
      {
        sessionId,
        successes: successes.length,
        failures: failures.length,
        tokensWasted,
        unnecessarySteps,
      },
      "Execution analysis complete"
    );

    return {
      successes,
      failures,
      efficiency: { tokensWasted, unnecessarySteps, optimalPath },
    };
  }

  /**
   * Generate improvement suggestions for a project based on all
   * recorded sessions.
   */
  generateImprovements(projectId: string): ImprovementSet {
    const projectSessions = this.sessions.filter(
      (s) => s.projectId === projectId
    );

    if (projectSessions.length === 0) {
      logger.warn(
        { projectId },
        "No sessions found for improvement generation"
      );
      return {
        promptImprovements: [],
        toolUsagePatterns: [],
        workflowOptimizations: [],
      };
    }

    const stats = this.gatherSessionStats(projectSessions);
    const toolUsagePatterns = this.generateToolPatterns(stats);
    const promptImprovements = this.generatePromptImprovements(
      stats,
      projectSessions.length
    );
    const workflowOptimizations = this.generateWorkflowOptimizations(stats);

    logger.info(
      {
        projectId,
        promptImprovements: promptImprovements.length,
        toolUsagePatterns: toolUsagePatterns.length,
        workflowOptimizations: workflowOptimizations.length,
      },
      "Generated improvement suggestions"
    );

    return { promptImprovements, toolUsagePatterns, workflowOptimizations };
  }

  /**
   * Apply a set of improvements to a project's configuration.
   * Validates each improvement before applying and reports results.
   */
  applyImprovements(
    projectId: string,
    improvements: Array<{
      category: StoredImprovement["category"];
      description: string;
    }>
  ): ApplyResult {
    let applied = 0;
    let skipped = 0;
    const results: ApplyResult["results"] = [];

    for (const improvement of improvements) {
      const stored: StoredImprovement = {
        id: generateId("imp"),
        projectId,
        category: improvement.category,
        description: improvement.description,
        status: "pending",
      };

      // Validate the improvement before applying
      const validationResult = this.validateImprovement(stored);
      if (!validationResult.valid) {
        stored.status = "skipped";
        skipped += 1;
        results.push({
          improvement: improvement.description,
          status: "skipped",
          reason: validationResult.reason,
        });
        continue;
      }

      // Apply the improvement
      stored.status = "applied";
      stored.appliedAt = new Date().toISOString();
      applied += 1;
      results.push({
        improvement: improvement.description,
        status: "applied",
      });

      // Store for tracking
      const existing = this.improvements.get(projectId) ?? [];
      existing.push(stored);
      this.improvements.set(projectId, existing);
    }

    logger.info(
      { projectId, applied, skipped, total: improvements.length },
      "Improvements application complete"
    );

    return { applied, skipped, results };
  }

  /**
   * Get all stored improvements for a project.
   */
  getImprovements(projectId: string): StoredImprovement[] {
    return this.improvements.get(projectId) ?? [];
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private gatherSessionStats(sessions: SessionRecord[]): {
    avgFailSteps: number;
    avgSuccessSteps: number;
    failedCount: number;
    failuresByTool: Map<string, number>;
    successesByTool: Map<string, number>;
    totalCount: number;
    totalTokens: { success: number; failure: number };
  } {
    const failuresByTool = new Map<string, number>();
    const successesByTool = new Map<string, number>();
    const totalTokens = { success: 0, failure: 0 };

    for (const session of sessions) {
      for (const action of session.actions) {
        if (action.result === "error") {
          failuresByTool.set(
            action.tool,
            (failuresByTool.get(action.tool) ?? 0) + 1
          );
          totalTokens.failure += action.tokensUsed;
        } else if (action.result === "success") {
          successesByTool.set(
            action.tool,
            (successesByTool.get(action.tool) ?? 0) + 1
          );
          totalTokens.success += action.tokensUsed;
        }
      }
    }

    const successful = sessions.filter((s) => s.outcome === "success");
    const failed = sessions.filter((s) => s.outcome === "failure");

    const avgSuccessSteps =
      successful.length > 0
        ? successful.reduce((sum, s) => sum + s.actions.length, 0) /
          successful.length
        : 0;

    const avgFailSteps =
      failed.length > 0
        ? failed.reduce((sum, s) => sum + s.actions.length, 0) / failed.length
        : 0;

    return {
      failuresByTool,
      successesByTool,
      totalTokens,
      failedCount: failed.length,
      totalCount: sessions.length,
      avgSuccessSteps,
      avgFailSteps,
    };
  }

  private generateToolPatterns(
    stats: ReturnType<SelfImprovingAgent["gatherSessionStats"]>
  ): ImprovementSet["toolUsagePatterns"] {
    const patterns: ImprovementSet["toolUsagePatterns"] = [];
    for (const [tool, failCount] of stats.failuresByTool) {
      const successCount = stats.successesByTool.get(tool) ?? 0;
      const total = failCount + successCount;
      const failRate = failCount / total;

      if (failRate > 0.5 && total >= 3) {
        patterns.push({
          pattern: `High failure rate for ${tool}: ${(failRate * 100).toFixed(0)}%`,
          recommendation: `Review ${tool} usage patterns — consider adding validation before invocation or switching to alternative tools`,
        });
      }
    }
    return patterns;
  }

  private generatePromptImprovements(
    stats: ReturnType<SelfImprovingAgent["gatherSessionStats"]>,
    totalSessions: number
  ): ImprovementSet["promptImprovements"] {
    const improvements: ImprovementSet["promptImprovements"] = [];
    if (stats.failedCount > totalSessions - stats.failedCount) {
      improvements.push({
        role: "all",
        improvement:
          "Add explicit error handling instructions to system prompts",
        reasoning: `${stats.failedCount}/${totalSessions} sessions failed — agents need clearer error recovery guidance`,
      });
    }
    return improvements;
  }

  private generateWorkflowOptimizations(
    stats: ReturnType<SelfImprovingAgent["gatherSessionStats"]>
  ): ImprovementSet["workflowOptimizations"] {
    const optimizations: ImprovementSet["workflowOptimizations"] = [];

    if (
      stats.avgFailSteps > stats.avgSuccessSteps * 1.5 &&
      stats.avgSuccessSteps > 0
    ) {
      optimizations.push({
        current: `Failed sessions average ${Math.round(stats.avgFailSteps)} steps`,
        suggested: `Cap execution at ${Math.round(stats.avgSuccessSteps * 1.2)} steps before requesting human input`,
        savings: `~${Math.round(stats.avgFailSteps - stats.avgSuccessSteps)} fewer wasted steps per failed session`,
      });
    }

    if (stats.totalTokens.failure > stats.totalTokens.success * 0.5) {
      optimizations.push({
        current: `${stats.totalTokens.failure} tokens spent on failed actions`,
        suggested:
          "Implement early termination on repeated errors and add pre-validation checks",
        savings: `Up to ${Math.round(stats.totalTokens.failure * 0.6)} tokens per project`,
      });
    }

    return optimizations;
  }

  private detectActionPattern(
    actions: SessionRecord["actions"],
    index: number
  ): string {
    const window = actions.slice(Math.max(0, index - 1), index + 2);
    const tools = window.map((a) => a.tool);
    return tools.join(" -> ");
  }

  private inferRootCause(action: SessionRecord["actions"][0]): string {
    const summary = action.resultSummary.toLowerCase();

    if (summary.includes("not found") || summary.includes("no such file")) {
      return "Resource not found — incorrect path or missing prerequisite";
    }
    if (summary.includes("permission") || summary.includes("unauthorized")) {
      return "Permission denied — insufficient access rights";
    }
    if (summary.includes("timeout")) {
      return "Operation timed out — resource may be overloaded or unreachable";
    }
    if (summary.includes("syntax") || summary.includes("parse")) {
      return "Syntax or parsing error — malformed input provided to tool";
    }
    return "Unknown root cause — review action output for details";
  }

  private suggestAvoidance(rootCause: string, tool: string): string {
    if (rootCause.includes("not found")) {
      return `Verify resource existence before calling ${tool}`;
    }
    if (rootCause.includes("Permission")) {
      return `Check permissions before invoking ${tool}`;
    }
    if (rootCause.includes("timed out")) {
      return `Add timeout handling or use async pattern for ${tool}`;
    }
    if (rootCause.includes("Syntax")) {
      return `Validate input format before passing to ${tool}`;
    }
    return `Add pre-checks before calling ${tool} and handle errors gracefully`;
  }

  private validateImprovement(improvement: StoredImprovement): {
    valid: boolean;
    reason?: string;
  } {
    if (!improvement.description || improvement.description.length < 10) {
      return { valid: false, reason: "Improvement description too short" };
    }

    // Check for duplicates
    const existing = this.improvements.get(improvement.projectId) ?? [];
    const isDuplicate = existing.some(
      (e) => e.description === improvement.description && e.status === "applied"
    );
    if (isDuplicate) {
      return { valid: false, reason: "Duplicate improvement already applied" };
    }

    return { valid: true };
  }
}
