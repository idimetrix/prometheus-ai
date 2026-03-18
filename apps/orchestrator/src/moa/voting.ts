import { createLogger } from "@prometheus/logger";

const _logger = createLogger("orchestrator:moa:voting");

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
  | "test-driven";

export interface VoteResult {
  reasoning: string;
  scores: number[];
  strategy: VotingStrategy;
  winner: number;
}

/**
 * MoA Voting implements three strategies for selecting the best
 * response from multiple model outputs.
 */
export class MoAVoting {
  /**
   * Vote on the best response using the specified strategy.
   */
  vote(
    responses: Array<{ model: string; output: string; confidence: number }>,
    strategy: VotingStrategy = "length-weighted"
  ): VoteResult {
    switch (strategy) {
      case "length-weighted":
        return this.lengthWeightedVote(responses);
      case "cross-evaluation":
        return this.crossEvaluationVote(responses);
      case "test-driven":
        return this.testDrivenVote(responses);
      default:
        return this.lengthWeightedVote(responses);
    }
  }

  /**
   * Length-weighted voting: longer, more detailed responses score higher,
   * combined with model confidence.
   */
  private lengthWeightedVote(
    responses: Array<{ model: string; output: string; confidence: number }>
  ): VoteResult {
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
  private crossEvaluationVote(
    responses: Array<{ model: string; output: string; confidence: number }>
  ): VoteResult {
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
  private testDrivenVote(
    responses: Array<{ model: string; output: string; confidence: number }>
  ): VoteResult {
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
