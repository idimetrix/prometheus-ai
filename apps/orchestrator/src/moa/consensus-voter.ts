/**
 * MOON-046: Multi-Agent Consensus Voting (MoA)
 *
 * Runs multiple agents on the same task in parallel and picks the best
 * result using configurable voting strategies: majority, quality_score,
 * or hybrid. Extends the existing MoA voting infrastructure with a
 * higher-level orchestration layer that manages agent dispatch,
 * scoring, and consensus measurement.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:moa:consensus-voter");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentResult {
  agentId: string;
  output: string;
  reasoning: string;
  score: number;
}

export interface ConsensusVoteResult {
  /** All individual agent results */
  allResults: AgentResult[];
  /** Agreement level between agents (0-1) */
  consensus: number;
  /** Human-readable description of the voting process */
  votingDetails: string;
  /** The winning agent result */
  winner: AgentResult;
}

export type ConsensusStrategy = "majority" | "quality_score" | "hybrid";

export interface ConsensusVoteOptions {
  /** Number of agents to dispatch (default: 3) */
  agentCount?: number;
  /** The task to run across agents */
  task: string;
  /** Voting strategy to determine the winner */
  votingStrategy: ConsensusStrategy;
}

/** Injected handler that dispatches a task to a single agent */
export type AgentDispatcher = (
  task: string,
  agentId: string
) => Promise<{ output: string; reasoning: string }>;

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const HEADER_RE = /^#{1,3}\s/m;
const LIST_ITEM_RE = /^[-*]\s/m;
const WHITESPACE_RE = /\s+/;

function scoreOutputQuality(output: string): number {
  if (!output || output.length === 0) {
    return 0;
  }

  let score = 0.3; // Base score for producing output

  // Structure indicators
  if (CODE_BLOCK_RE.test(output)) {
    score += 0.15;
  }
  if (HEADER_RE.test(output)) {
    score += 0.1;
  }
  if (LIST_ITEM_RE.test(output)) {
    score += 0.1;
  }

  // Length signal (capped at 2000 chars)
  const lengthScore = Math.min(output.length / 2000, 1.0) * 0.2;
  score += lengthScore;

  // Specificity: number of unique meaningful words
  const words = new Set(
    output
      .toLowerCase()
      .split(WHITESPACE_RE)
      .filter((w) => w.length > 4)
  );
  const specificityScore = Math.min(words.size / 100, 1.0) * 0.15;
  score += specificityScore;

  return Math.min(1, score);
}

function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(
    a
      .toLowerCase()
      .split(WHITESPACE_RE)
      .filter((w) => w.length > 3)
  );
  const wordsB = new Set(
    b
      .toLowerCase()
      .split(WHITESPACE_RE)
      .filter((w) => w.length > 3)
  );

  if (wordsA.size === 0 || wordsB.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) {
      overlap++;
    }
  }

  const union = new Set([...wordsA, ...wordsB]).size;
  return union > 0 ? overlap / union : 0;
}

// ---------------------------------------------------------------------------
// ConsensusVoter
// ---------------------------------------------------------------------------

export class ConsensusVoter {
  private readonly dispatcher: AgentDispatcher;

  constructor(dispatcher: AgentDispatcher) {
    this.dispatcher = dispatcher;
  }

  /**
   * Runs multiple agents on the same task and picks the best result
   * using the specified voting strategy.
   */
  async vote(options: ConsensusVoteOptions): Promise<ConsensusVoteResult> {
    const { task, votingStrategy, agentCount = 3 } = options;

    logger.info(
      { task: task.slice(0, 100), agentCount, votingStrategy },
      "Starting consensus vote"
    );

    // Dispatch task to N agents in parallel
    const agentIds = Array.from({ length: agentCount }, (_, i) =>
      generateId(`agent-${i}`)
    );

    const results = await Promise.all(
      agentIds.map(async (agentId) => {
        try {
          const { output, reasoning } = await this.dispatcher(task, agentId);
          const score = scoreOutputQuality(output);
          return { agentId, output, reasoning, score };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.warn({ agentId, error: msg }, "Agent dispatch failed");
          return {
            agentId,
            output: "",
            reasoning: `Error: ${msg}`,
            score: 0,
          };
        }
      })
    );

    // Filter out failed results for voting (but keep in allResults)
    const validResults = results.filter((r) => r.output.length > 0);

    if (validResults.length === 0) {
      const fallback = results[0] ?? {
        agentId: "none",
        output: "",
        reasoning: "All agents failed",
        score: 0,
      };
      return {
        winner: fallback,
        allResults: results,
        consensus: 0,
        votingDetails: "All agents failed to produce output",
      };
    }

    // Apply voting strategy
    const { winner, votingDetails } = this.applyStrategy(
      validResults,
      votingStrategy
    );

    // Compute consensus: average pairwise similarity between valid outputs
    const consensus = this.computeConsensus(validResults);

    logger.info(
      {
        winnerId: winner.agentId,
        winnerScore: winner.score.toFixed(3),
        consensus: consensus.toFixed(3),
        strategy: votingStrategy,
      },
      "Consensus vote complete"
    );

    return {
      winner,
      allResults: results,
      consensus,
      votingDetails,
    };
  }

  private applyStrategy(
    results: AgentResult[],
    strategy: ConsensusStrategy
  ): { winner: AgentResult; votingDetails: string } {
    switch (strategy) {
      case "majority":
        return this.majorityVote(results);
      case "quality_score":
        return this.qualityScoreVote(results);
      case "hybrid":
        return this.hybridVote(results);
      default:
        return this.qualityScoreVote(results);
    }
  }

  /**
   * Majority vote: group similar outputs and pick the group with the
   * most members. Within that group, pick the highest-quality output.
   */
  private majorityVote(results: AgentResult[]): {
    winner: AgentResult;
    votingDetails: string;
  } {
    // Cluster results by similarity (threshold 0.4)
    const clusters: AgentResult[][] = [];

    for (const result of results) {
      let placed = false;
      for (const cluster of clusters) {
        const representative = cluster[0];
        if (
          representative &&
          computeSimilarity(result.output, representative.output) > 0.4
        ) {
          cluster.push(result);
          placed = true;
          break;
        }
      }
      if (!placed) {
        clusters.push([result]);
      }
    }

    // Find the largest cluster
    let largestCluster = clusters[0] ?? [];
    for (const cluster of clusters) {
      if (cluster.length > largestCluster.length) {
        largestCluster = cluster;
      }
    }

    // Within the largest cluster, pick the highest-scoring result
    const sorted = [...largestCluster].sort((a, b) => b.score - a.score);
    // results is guaranteed non-empty by caller; sorted inherits from largestCluster
    const winner = (sorted[0] ?? results[0]) as AgentResult;

    const details = `Majority vote: ${clusters.length} clusters found. Largest cluster has ${largestCluster.length}/${results.length} agents. Winner: ${winner.agentId} (score ${winner.score.toFixed(3)})`;

    return { winner, votingDetails: details };
  }

  /**
   * Quality score vote: pick the agent with the highest quality score.
   */
  private qualityScoreVote(results: AgentResult[]): {
    winner: AgentResult;
    votingDetails: string;
  } {
    const sorted = [...results].sort((a, b) => b.score - a.score);
    // results is guaranteed non-empty by caller
    const winner = (sorted[0] ?? results[0]) as AgentResult;

    const scores = results
      .map((r) => `${r.agentId}: ${r.score.toFixed(3)}`)
      .join(", ");

    return {
      winner,
      votingDetails: `Quality score vote: selected highest scorer. Scores: [${scores}]`,
    };
  }

  /**
   * Hybrid vote: combines majority agreement with quality scoring.
   * Agreement bonus: agents whose output is similar to others get a bonus.
   */
  private hybridVote(results: AgentResult[]): {
    winner: AgentResult;
    votingDetails: string;
  } {
    const hybridScores = results.map((result) => {
      // Base quality score (60% weight)
      let hybridScore = result.score * 0.6;

      // Agreement bonus (40% weight): average similarity to all other outputs
      const others = results.filter((r) => r.agentId !== result.agentId);
      if (others.length > 0) {
        const avgSimilarity =
          others.reduce(
            (sum, other) =>
              sum + computeSimilarity(result.output, other.output),
            0
          ) / others.length;
        hybridScore += avgSimilarity * 0.4;
      }

      return { ...result, hybridScore };
    });

    const sorted = hybridScores.sort((a, b) => b.hybridScore - a.hybridScore);
    // results is guaranteed non-empty by caller
    const winner = (sorted[0] ?? hybridScores[0]) as AgentResult & {
      hybridScore: number;
    };

    const scores = sorted
      .map(
        (r) =>
          `${r.agentId}: quality=${r.score.toFixed(3)} hybrid=${r.hybridScore.toFixed(3)}`
      )
      .join(", ");

    return {
      winner: {
        agentId: winner.agentId,
        output: winner.output,
        reasoning: winner.reasoning,
        score: winner.score,
      },
      votingDetails: `Hybrid vote (60% quality + 40% agreement). Scores: [${scores}]`,
    };
  }

  /**
   * Compute consensus as the average pairwise Jaccard similarity
   * of all valid outputs.
   */
  private computeConsensus(results: AgentResult[]): number {
    if (results.length < 2) {
      return 1;
    }

    let totalSimilarity = 0;
    let pairCount = 0;

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const a = results[i];
        const b = results[j];
        if (a && b) {
          totalSimilarity += computeSimilarity(a.output, b.output);
          pairCount++;
        }
      }
    }

    return pairCount > 0 ? totalSimilarity / pairCount : 0;
  }
}
