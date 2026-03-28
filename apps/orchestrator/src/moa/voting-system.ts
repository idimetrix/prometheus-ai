/**
 * GAP-046: MoA Voting System
 *
 * Collects proposals from multiple models, scores each on correctness,
 * style, and completeness, selects the best proposal or synthesizes from
 * multiple, and records voting outcomes for model quality tracking.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:moa:voting-system");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Proposal {
  completenessScore?: number;
  content: string;
  correctnessScore?: number;
  model: string;
  styleScore?: number;
}

export interface ScoredProposal extends Proposal {
  completenessScore: number;
  correctnessScore: number;
  overallScore: number;
  styleScore: number;
}

export interface VotingOutcome {
  proposals: ScoredProposal[];
  selectedIndex: number;
  selectedModel: string;
  strategy: "best-of" | "synthesized" | "unanimous";
  synthesizedContent?: string;
  taskId: string;
  timestamp: number;
}

export interface ModelQualityTracker {
  avgCompleteness: number;
  avgCorrectness: number;
  avgOverall: number;
  avgStyle: number;
  model: string;
  sampleCount: number;
  winCount: number;
}

// ---------------------------------------------------------------------------
// VotingSystem
// ---------------------------------------------------------------------------

export class VotingSystem {
  private readonly outcomes: VotingOutcome[] = [];
  private readonly modelStats = new Map<
    string,
    {
      completeness: number;
      correctness: number;
      count: number;
      overall: number;
      style: number;
      wins: number;
    }
  >();

  /**
   * Score a set of proposals and select the best one.
   */
  vote(
    taskId: string,
    proposals: Proposal[],
    options?: { synthesize?: boolean }
  ): VotingOutcome {
    if (proposals.length === 0) {
      throw new Error("At least one proposal is required");
    }

    // Score each proposal
    const scored = proposals.map((p) => this.scoreProposal(p));

    // Sort by overall score descending
    const sorted = [...scored].sort((a, b) => b.overallScore - a.overallScore);
    const best = sorted[0] as ScoredProposal;
    const selectedIndex = scored.indexOf(best);

    // Check if we should synthesize
    const shouldSynthesize =
      options?.synthesize &&
      sorted.length >= 2 &&
      (sorted[1]?.overallScore ?? 0) >= best.overallScore * 0.9;

    let strategy: VotingOutcome["strategy"] = "best-of";
    let synthesizedContent: string | undefined;

    if (shouldSynthesize && sorted.length >= 2) {
      strategy = "synthesized";
      synthesizedContent = this.synthesize(sorted.slice(0, 3));
    }

    // Check for unanimous agreement
    if (
      sorted.length >= 3 &&
      sorted.every((s) => Math.abs(s.overallScore - best.overallScore) < 0.05)
    ) {
      strategy = "unanimous";
    }

    const outcome: VotingOutcome = {
      taskId,
      proposals: scored,
      selectedIndex,
      selectedModel: best.model,
      strategy,
      synthesizedContent,
      timestamp: Date.now(),
    };

    this.outcomes.push(outcome);
    if (this.outcomes.length > 5000) {
      this.outcomes.splice(0, this.outcomes.length - 5000);
    }

    // Update model stats
    for (const s of scored) {
      this.updateModelStats(s, s === best);
    }

    logger.info(
      {
        taskId,
        strategy,
        winner: best.model,
        winnerScore: best.overallScore.toFixed(3),
        proposalCount: proposals.length,
      },
      "Voting completed"
    );

    return outcome;
  }

  /**
   * Get model quality tracking data.
   */
  getModelQuality(): ModelQualityTracker[] {
    const results: ModelQualityTracker[] = [];

    for (const [model, stats] of this.modelStats) {
      if (stats.count === 0) {
        continue;
      }
      results.push({
        model,
        sampleCount: stats.count,
        winCount: stats.wins,
        avgCorrectness: stats.correctness / stats.count,
        avgStyle: stats.style / stats.count,
        avgCompleteness: stats.completeness / stats.count,
        avgOverall: stats.overall / stats.count,
      });
    }

    return results.sort((a, b) => b.avgOverall - a.avgOverall);
  }

  /**
   * Get voting history for analysis.
   */
  getOutcomeHistory(limit = 100): VotingOutcome[] {
    return this.outcomes.slice(-limit);
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private scoreProposal(proposal: Proposal): ScoredProposal {
    // Use provided scores or compute heuristic scores
    const correctness =
      proposal.correctnessScore ?? this.heuristicCorrectness(proposal.content);
    const style = proposal.styleScore ?? this.heuristicStyle(proposal.content);
    const completeness =
      proposal.completenessScore ??
      this.heuristicCompleteness(proposal.content);

    const overallScore = correctness * 0.5 + style * 0.2 + completeness * 0.3;

    return {
      ...proposal,
      correctnessScore: correctness,
      styleScore: style,
      completenessScore: completeness,
      overallScore,
    };
  }

  private heuristicCorrectness(content: string): number {
    // Heuristic: longer content with code blocks tends to be more correct
    const hasCode = content.includes("```") || content.includes("function ");
    const length = content.length;
    let score = 0.5;
    if (hasCode) {
      score += 0.2;
    }
    if (length > 200) {
      score += 0.1;
    }
    if (length > 500) {
      score += 0.1;
    }
    return Math.min(score, 1.0);
  }

  private heuristicStyle(content: string): number {
    let score = 0.5;
    if (content.includes("\n")) {
      score += 0.1;
    }
    if (content.includes("//") || content.includes("/*")) {
      score += 0.1;
    }
    if (content.length > 100 && content.length < 5000) {
      score += 0.2;
    }
    return Math.min(score, 1.0);
  }

  private heuristicCompleteness(content: string): number {
    let score = 0.5;
    if (content.length > 300) {
      score += 0.2;
    }
    if (content.includes("export")) {
      score += 0.1;
    }
    if (content.includes("return")) {
      score += 0.1;
    }
    return Math.min(score, 1.0);
  }

  private synthesize(topProposals: ScoredProposal[]): string {
    // Simple synthesis: take the best proposal and note what others add
    const best = topProposals[0];
    if (!best) {
      return "";
    }

    const additions: string[] = [];
    for (const proposal of topProposals.slice(1)) {
      if (proposal.completenessScore > (best.completenessScore ?? 0)) {
        additions.push(
          `/* Additional insight from ${proposal.model}: included for completeness */`
        );
      }
    }

    return additions.length > 0
      ? `${best.content}\n\n${additions.join("\n")}`
      : best.content;
  }

  private updateModelStats(proposal: ScoredProposal, isWinner: boolean): void {
    const existing = this.modelStats.get(proposal.model) ?? {
      count: 0,
      wins: 0,
      correctness: 0,
      style: 0,
      completeness: 0,
      overall: 0,
    };

    existing.count++;
    if (isWinner) {
      existing.wins++;
    }
    existing.correctness += proposal.correctnessScore;
    existing.style += proposal.styleScore;
    existing.completeness += proposal.completenessScore;
    existing.overall += proposal.overallScore;

    this.modelStats.set(proposal.model, existing);
  }
}
