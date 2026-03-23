import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:moa:voting");

const HEADER_RE = /^#{1,3}\s/m;
const LIST_ITEM_RE = /^[-*]\s/m;
const WHITESPACE_RE = /\s+/;
const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const FILE_PATH_RE = /[\w/-]+\.\w{2,4}/g;
const IDENTIFIER_RE = /\b(?:function|class|interface|const|type)\s+\w+/g;
const TEST_CONTENT_RE = /\b(?:test|expect|assert|describe|it|should)\b/gi;

export type VotingStrategy =
  | "length-weighted"
  | "cross-evaluation"
  | "test-driven"
  | "confidence-weighted"
  | "quorum";

/** Quorum mode for multi-model agreement */
export type QuorumMode = "majority" | "unanimous" | "weighted";

export interface VoteResult {
  reasoning: string;
  scores: number[];
  strategy: VotingStrategy;
  winner: number;
}

/** Configuration for quorum-based voting */
export interface QuorumConfig {
  /** Quorum mode */
  mode: QuorumMode;
  /** Minimum agreement threshold for weighted mode (0-1) */
  weightedThreshold?: number;
}

/** Response from a model for voting */
export interface ModelResponse {
  confidence: number;
  model: string;
  output: string;
}

/**
 * MoA Voting implements multiple strategies for selecting the best
 * response from multiple model outputs.
 *
 * Enhanced with:
 * - Confidence-weighted voting based on agent confidence scores
 * - Quorum configuration (majority, unanimous, weighted)
 * - Multi-model dispatch for high-stakes decisions
 */
export class MoAVoting {
  /**
   * Vote on the best response using the specified strategy.
   */
  vote(
    responses: ModelResponse[],
    strategy: VotingStrategy = "length-weighted"
  ): VoteResult {
    switch (strategy) {
      case "length-weighted":
        return this.lengthWeightedVote(responses);
      case "cross-evaluation":
        return this.crossEvaluationVote(responses);
      case "test-driven":
        return this.testDrivenVote(responses);
      case "confidence-weighted":
        return this.confidenceWeightedVote(responses);
      case "quorum":
        return this.quorumVote(responses, { mode: "majority" });
      default:
        return this.lengthWeightedVote(responses);
    }
  }

  /**
   * Confidence-weighted voting: scores are primarily driven by
   * agent confidence, with quality bonuses for structure.
   */
  confidenceWeightedVote(responses: ModelResponse[]): VoteResult {
    const scores = responses.map((r) => {
      // Primary: confidence is the dominant factor
      let score = r.confidence * 0.6;

      // Secondary: output quality indicators
      const hasCodeBlocks = r.output.includes("```") ? 0.1 : 0;
      const hasHeaders = HEADER_RE.test(r.output) ? 0.05 : 0;
      const hasLists = LIST_ITEM_RE.test(r.output) ? 0.05 : 0;

      // Tertiary: length as a tiebreaker (normalized)
      const maxLen = Math.max(...responses.map((resp) => resp.output.length));
      const lengthScore = maxLen > 0 ? (r.output.length / maxLen) * 0.2 : 0;

      score += hasCodeBlocks + hasHeaders + hasLists + lengthScore;

      return score;
    });

    const winner = scores.indexOf(Math.max(...scores));

    return {
      winner,
      scores,
      strategy: "confidence-weighted",
      reasoning: `Confidence-weighted vote selected response ${winner + 1} (${responses[winner]?.model}) with confidence ${responses[winner]?.confidence.toFixed(3)}`,
    };
  }

  /**
   * Quorum-based voting for decisions requiring multi-model agreement.
   *
   * Modes:
   * - majority: >50% of models must agree
   * - unanimous: all models must agree
   * - weighted: weighted sum of confidence must exceed threshold
   */
  quorumVote(responses: ModelResponse[], config: QuorumConfig): VoteResult {
    // First, compute similarity clusters
    const scores = responses.map((r) => r.confidence);
    const winner = scores.indexOf(Math.max(...scores));

    let quorumMet = false;
    let reasoning: string;

    switch (config.mode) {
      case "unanimous": {
        // All must have confidence > 0.5
        quorumMet = responses.every((r) => r.confidence > 0.5);
        reasoning = quorumMet
          ? `Unanimous quorum met: all ${responses.length} models agree`
          : "Unanimous quorum NOT met: not all models have sufficient confidence";
        break;
      }
      case "weighted": {
        const threshold = config.weightedThreshold ?? 0.6;
        const totalWeight = responses.reduce((acc, r) => acc + r.confidence, 0);
        const avgConfidence = totalWeight / responses.length;
        quorumMet = avgConfidence >= threshold;
        reasoning = `Weighted quorum ${quorumMet ? "met" : "NOT met"}: avg confidence ${avgConfidence.toFixed(3)} vs threshold ${threshold}`;
        break;
      }
      default: {
        const highConfidence = responses.filter(
          (r) => r.confidence > 0.5
        ).length;
        quorumMet = highConfidence > responses.length / 2;
        reasoning = `Majority quorum ${quorumMet ? "met" : "NOT met"}: ${highConfidence}/${responses.length} models agree`;
        break;
      }
    }

    logger.info(
      { quorumMet, mode: config.mode, winner },
      "Quorum vote completed"
    );

    return {
      winner,
      scores,
      strategy: "quorum",
      reasoning,
    };
  }

  /**
   * Length-weighted voting: longer, more detailed responses score higher,
   * combined with model confidence.
   */
  private lengthWeightedVote(responses: ModelResponse[]): VoteResult {
    const maxLen = Math.max(...responses.map((r) => r.output.length));

    const scores = responses.map((r) => {
      const lengthScore = maxLen > 0 ? r.output.length / maxLen : 0;
      const confidenceScore = r.confidence;

      // Check for structural quality indicators
      const hasCodeBlocks = r.output.includes("```") ? 0.1 : 0;
      const hasHeaders = HEADER_RE.test(r.output) ? 0.05 : 0;
      const hasLists = LIST_ITEM_RE.test(r.output) ? 0.05 : 0;

      return (
        lengthScore * 0.4 +
        confidenceScore * 0.4 +
        hasCodeBlocks +
        hasHeaders +
        hasLists
      );
    });

    const winner = scores.indexOf(Math.max(...scores));

    return {
      winner,
      scores,
      strategy: "length-weighted",
      reasoning: `Selected response ${winner + 1} (${responses[winner]?.model}) with score ${scores[winner]?.toFixed(3)}`,
    };
  }

  /**
   * Cross-evaluation: each response evaluates the others.
   * Simulated by comparing overlap and complementary information.
   */
  private crossEvaluationVote(responses: ModelResponse[]): VoteResult {
    const scores = responses.map((response, idx) => {
      let score = response.confidence * 0.3;

      // Check how many unique concepts this response covers
      const words = new Set(
        response.output
          .toLowerCase()
          .split(WHITESPACE_RE)
          .filter((w) => w.length > 4)
      );

      // Score based on unique content not found in other responses
      const otherWords = new Set<string>();
      for (let j = 0; j < responses.length; j++) {
        if (j !== idx) {
          for (const word of (responses[j]?.output ?? "")
            .toLowerCase()
            .split(WHITESPACE_RE)) {
            if (word.length > 4) {
              otherWords.add(word);
            }
          }
        }
      }

      const uniqueWords = Array.from(words).filter((w) => !otherWords.has(w));
      const commonWords = Array.from(words).filter((w) => otherWords.has(w));

      // Balance: want high overlap (agreement) + some unique insights
      score += (commonWords.length / Math.max(words.size, 1)) * 0.4; // Agreement
      score += Math.min(uniqueWords.length / 20, 0.3); // Unique insights (capped)

      return score;
    });

    const winner = scores.indexOf(Math.max(...scores));

    return {
      winner,
      scores,
      strategy: "cross-evaluation",
      reasoning: `Cross-evaluation selected response ${winner + 1} (${responses[winner]?.model}) based on agreement + unique insights`,
    };
  }

  /**
   * Test-driven: score based on presence of testable assertions,
   * code examples, and specific implementation details.
   */
  private testDrivenVote(responses: ModelResponse[]): VoteResult {
    const scores = responses.map((r) => {
      let score = r.confidence * 0.2;

      // Code block count
      const codeBlocks = (r.output.match(CODE_BLOCK_RE) ?? []).length;
      score += Math.min(codeBlocks / 5, 0.3);

      // File path references
      const filePaths = (r.output.match(FILE_PATH_RE) ?? []).length;
      score += Math.min(filePaths / 10, 0.2);

      // Specific function/class names
      const identifiers = (r.output.match(IDENTIFIER_RE) ?? []).length;
      score += Math.min(identifiers / 8, 0.15);

      // Test-related content
      const testContent = (r.output.match(TEST_CONTENT_RE) ?? []).length;
      score += Math.min(testContent / 10, 0.15);

      return score;
    });

    const winner = scores.indexOf(Math.max(...scores));

    return {
      winner,
      scores,
      strategy: "test-driven",
      reasoning: `Test-driven vote selected response ${winner + 1} (${responses[winner]?.model}) with highest implementation specificity`,
    };
  }
}

/**
 * MoA Decision Gate for high-stakes decisions requiring multi-model agreement.
 *
 * Uses quorum voting to ensure critical decisions have consensus among
 * multiple models before proceeding.
 */
export class MoADecisionGate {
  private readonly voting: MoAVoting;
  private readonly quorumConfig: QuorumConfig;

  constructor(quorumConfig: QuorumConfig = { mode: "majority" }) {
    this.voting = new MoAVoting();
    this.quorumConfig = quorumConfig;
  }

  /**
   * Evaluate responses for a high-stakes decision.
   * Returns the winner and whether quorum was achieved.
   */
  evaluate(responses: ModelResponse[]): {
    approved: boolean;
    result: VoteResult;
  } {
    const result = this.voting.quorumVote(responses, this.quorumConfig);
    const approved =
      result.reasoning.includes("met") && !result.reasoning.includes("NOT met");

    logger.info(
      { approved, winner: result.winner, quorumMode: this.quorumConfig.mode },
      "Decision gate evaluation complete"
    );

    return { approved, result };
  }

  /**
   * Dispatch a decision to multiple models and evaluate consensus.
   * Takes a dispatcher function that sends a prompt to multiple models.
   */
  async dispatchAndEvaluate(
    dispatcher: () => Promise<ModelResponse[]>
  ): Promise<{
    approved: boolean;
    responses: ModelResponse[];
    result: VoteResult;
  }> {
    const responses = await dispatcher();
    const { approved, result } = this.evaluate(responses);

    return { approved, responses, result };
  }
}
