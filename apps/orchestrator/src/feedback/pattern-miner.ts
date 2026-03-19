/**
 * Phase 8.4: Cross-Session Pattern Mining.
 * Mines execution tracker data for tool effectiveness by task type,
 * optimal iteration counts, and common blocker resolutions.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:pattern-miner");

export interface ExecutionRecord {
  agentRole: string;
  duration: number;
  errorType?: string;
  iterations: number;
  success: boolean;
  taskType: string;
}

export interface ToolEffectiveness {
  agentRole: string;
  averageDuration: number;
  successRate: number;
  taskType: string;
}

export interface OptimalIterations {
  averageIterations: number;
  maxIterations: number;
  medianIterations: number;
  taskType: string;
}

export interface BlockerPattern {
  errorType: string;
  frequency: number;
  resolutions: string[];
}

export interface MinedPatterns {
  blockerPatterns: BlockerPattern[];
  optimalIterations: OptimalIterations[];
  toolEffectiveness: ToolEffectiveness[];
}

export class PatternMiner {
  /**
   * Mine patterns from execution records for a project.
   */
  mine(records: ExecutionRecord[]): MinedPatterns {
    if (records.length === 0) {
      return {
        toolEffectiveness: [],
        optimalIterations: [],
        blockerPatterns: [],
      };
    }

    // Group by task type
    const byTaskType = new Map<
      string,
      Array<{
        success: boolean;
        duration: number;
        iterations: number;
        agentRole: string;
        errorType?: string;
      }>
    >();

    for (const record of records) {
      const key = record.taskType;
      if (!byTaskType.has(key)) {
        byTaskType.set(key, []);
      }
      byTaskType.get(key)?.push(record);
    }

    // Compute tool effectiveness
    const toolEffectiveness: ToolEffectiveness[] = [];
    for (const [taskType, entries] of byTaskType) {
      const byRole = new Map<
        string,
        { total: number; successes: number; totalDuration: number }
      >();

      for (const entry of entries) {
        const stats = byRole.get(entry.agentRole) ?? {
          total: 0,
          successes: 0,
          totalDuration: 0,
        };
        stats.total++;
        if (entry.success) {
          stats.successes++;
        }
        stats.totalDuration += entry.duration;
        byRole.set(entry.agentRole, stats);
      }

      for (const [agentRole, stats] of byRole) {
        toolEffectiveness.push({
          taskType,
          agentRole,
          successRate: stats.total > 0 ? stats.successes / stats.total : 0,
          averageDuration:
            stats.total > 0 ? stats.totalDuration / stats.total : 0,
        });
      }
    }

    // Compute optimal iterations
    const optimalIterations: OptimalIterations[] = [];
    for (const [taskType, entries] of byTaskType) {
      const successfulIterations = entries
        .filter((e) => e.success)
        .map((e) => e.iterations)
        .sort((a, b) => a - b);

      if (successfulIterations.length > 0) {
        const median =
          successfulIterations[Math.floor(successfulIterations.length / 2)] ??
          0;
        const avg =
          successfulIterations.reduce((a, b) => a + b, 0) /
          successfulIterations.length;
        const max = successfulIterations.at(-1) ?? 0;

        optimalIterations.push({
          taskType,
          averageIterations: Math.round(avg),
          medianIterations: median,
          maxIterations: max,
        });
      }
    }

    // Compute blocker patterns
    const errorCounts = new Map<string, number>();
    for (const record of records) {
      if (record.errorType) {
        errorCounts.set(
          record.errorType,
          (errorCounts.get(record.errorType) ?? 0) + 1
        );
      }
    }

    const blockerPatterns: BlockerPattern[] = Array.from(errorCounts.entries())
      .map(([errorType, frequency]) => ({
        errorType,
        frequency,
        resolutions: [],
      }))
      .sort((a, b) => b.frequency - a.frequency);

    logger.info(
      {
        records: records.length,
        taskTypes: byTaskType.size,
        blockers: blockerPatterns.length,
      },
      "Patterns mined from execution history"
    );

    return { toolEffectiveness, optimalIterations, blockerPatterns };
  }
}
