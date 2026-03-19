/**
 * ResultSynthesizer — Merges outputs from parallel agents into a single
 * coherent result. Detects file conflicts and produces per-agent summaries.
 */
import { createLogger } from "@prometheus/logger";
import type { AgentResult, FileConflict } from "./fan-out-gather";

const logger = createLogger("orchestrator:result-synthesizer");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Summary of a single agent's contribution. */
export interface AgentSummary {
  agentId: string;
  agentRole: string;
  error?: string;
  filesChanged: string[];
  output: string;
  success: boolean;
}

/** A file that was successfully merged (no conflicts). */
export interface MergedFile {
  agentId: string;
  filePath: string;
}

/** A file that has unresolved conflicts between agents. */
export interface ConflictedFile {
  agents: string[];
  filePath: string;
  resolution: "pending" | "three_way_merge" | "escalated";
}

/** The synthesized result from all parallel agents. */
export interface SynthesizedResult {
  agentSummaries: AgentSummary[];
  combinedOutput: string;
  conflictedFiles: ConflictedFile[];
  mergedFiles: MergedFile[];
  overallSuccess: boolean;
  requiresHumanReview: boolean;
  totalFilesChanged: number;
}

// ---------------------------------------------------------------------------
// ResultSynthesizer
// ---------------------------------------------------------------------------

export class ResultSynthesizer {
  /**
   * Synthesize results from multiple parallel agents into a unified output.
   *
   * @param results - Per-agent results from the gather phase
   * @param conflicts - File conflicts detected during gather
   * @returns A synthesized result with merged files, conflicts, and summaries
   */
  synthesize(
    results: AgentResult[],
    conflicts: FileConflict[] = []
  ): SynthesizedResult {
    const conflictedPaths = new Set(conflicts.map((c) => c.filePath));

    // Build per-agent summaries
    const agentSummaries: AgentSummary[] = results.map((r) => ({
      agentId: r.agentId,
      agentRole: r.agentRole,
      success: r.success,
      output: r.output,
      filesChanged: r.filesChanged,
      error: r.error,
    }));

    // Classify files as merged or conflicted
    const mergedFiles: MergedFile[] = [];
    const seenFiles = new Set<string>();

    for (const result of results) {
      for (const filePath of result.filesChanged) {
        if (conflictedPaths.has(filePath)) {
          // Handled separately in conflictedFiles
          continue;
        }
        if (!seenFiles.has(filePath)) {
          seenFiles.add(filePath);
          mergedFiles.push({
            filePath,
            agentId: result.agentId,
          });
        }
      }
    }

    // Build conflicted files with resolution strategy
    const conflictedFiles: ConflictedFile[] = conflicts.map((conflict) => {
      const resolution = this.determineResolution(conflict, results);
      return {
        filePath: conflict.filePath,
        agents: conflict.agents,
        resolution,
      };
    });

    // Combine outputs from all successful agents
    const successfulResults = results.filter((r) => r.success);
    const combinedOutput = this.combineOutputs(successfulResults);

    // Overall success: all agents succeeded AND no unresolved conflicts
    const hasUnresolvedConflicts = conflictedFiles.some(
      (c) => c.resolution === "pending" || c.resolution === "escalated"
    );
    const allAgentsSucceeded = results.every((r) => r.success);
    const overallSuccess = allAgentsSucceeded && !hasUnresolvedConflicts;

    const totalFilesChanged = mergedFiles.length + conflictedFiles.length;

    logger.info(
      {
        agents: results.length,
        succeeded: successfulResults.length,
        mergedFiles: mergedFiles.length,
        conflictedFiles: conflictedFiles.length,
        overallSuccess,
      },
      "Result synthesis complete"
    );

    return {
      overallSuccess,
      combinedOutput,
      mergedFiles,
      conflictedFiles,
      agentSummaries,
      totalFilesChanged,
      requiresHumanReview: hasUnresolvedConflicts,
    };
  }

  /**
   * Determine the resolution strategy for a file conflict.
   *
   * Heuristics:
   * - If one agent failed and the other succeeded, prefer the successful agent
   * - If both agents are code-writing roles, attempt 3-way merge
   * - Otherwise, escalate for human review
   */
  private determineResolution(
    conflict: FileConflict,
    results: AgentResult[]
  ): ConflictedFile["resolution"] {
    const involvedResults = results.filter((r) =>
      conflict.agents.includes(r.agentId)
    );

    const successfulCount = involvedResults.filter((r) => r.success).length;

    // If only one agent succeeded, no real conflict — take the successful one
    if (successfulCount === 1) {
      return "three_way_merge";
    }

    // If all agents that touched this file succeeded, we need actual merge
    if (successfulCount === involvedResults.length) {
      // Check if agents have compatible roles (e.g., both coders)
      const roles = new Set(involvedResults.map((r) => r.agentRole));
      const coderRoles = new Set([
        "frontend_coder",
        "backend_coder",
        "integration_coder",
      ]);
      const allCoders = [...roles].every((r) => coderRoles.has(r));

      if (allCoders) {
        return "three_way_merge";
      }

      // Mixed roles modifying the same file — escalate
      return "escalated";
    }

    // Multiple failures — escalate
    return "escalated";
  }

  /**
   * Combine outputs from multiple successful agents into a coherent summary.
   */
  private combineOutputs(results: AgentResult[]): string {
    if (results.length === 0) {
      return "No agents completed successfully.";
    }

    if (results.length === 1) {
      return (results[0] as AgentResult).output;
    }

    const sections = results.map((r) => {
      const fileList =
        r.filesChanged.length > 0
          ? `\nFiles: ${r.filesChanged.join(", ")}`
          : "";
      return `### ${r.agentRole} (${r.agentId})${fileList}\n${r.output}`;
    });

    return `## Parallel Agent Results\n\n${sections.join("\n\n---\n\n")}`;
  }
}
