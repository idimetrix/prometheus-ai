/**
 * Relevance-Scored Context Assembly
 *
 * Scores context chunks by relevance to a task description using
 * keyword overlap, import proximity, and call chain distance.
 * Greedily fills a token budget with the most relevant chunks.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:relevance-scorer");

const WHITESPACE_RE = /\s+/;
const IMPORT_RE = /(?:import|require)\s*\(?['"]([^'"]+)['"]\)?/g;
const CALL_RE = /\b(\w+)\s*\(/g;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContextChunk {
  content: string;
  filePath: string;
  metadata?: Record<string, unknown>;
  /** Pre-computed token estimate (if available) */
  tokenEstimate?: number;
}

interface ScoredChunk {
  chunk: ContextChunk;
  score: number;
  tokens: number;
}

interface ContextUtilization {
  budgetUsed: number;
  chunksIncluded: number;
  totalBudget: number;
  totalChunks: number;
  utilization: number;
}

// ---------------------------------------------------------------------------
// RelevanceScorer
// ---------------------------------------------------------------------------

export class RelevanceScorer {
  private lastUtilization: ContextUtilization | null = null;

  /**
   * Score a single context chunk's relevance to a task description.
   * Returns a value between 0 and 1.
   */
  scoreRelevance(contextChunk: ContextChunk, taskDescription: string): number {
    const keywordScore = this.keywordOverlap(
      contextChunk.content,
      taskDescription
    );
    const pathScore = this.pathRelevance(
      contextChunk.filePath,
      taskDescription
    );
    const importScore = this.importProximity(
      contextChunk.content,
      taskDescription
    );
    const callChainScore = this.callChainDistance(
      contextChunk.content,
      taskDescription
    );

    // Weighted combination
    const score =
      keywordScore * 0.35 +
      pathScore * 0.25 +
      importScore * 0.2 +
      callChainScore * 0.2;

    return Math.min(1, Math.max(0, score));
  }

  /**
   * Assemble context by greedily filling the token budget
   * with the most relevant chunks.
   */
  assembleContext(
    chunks: ContextChunk[],
    tokenBudget: number,
    taskDescription: string
  ): ContextChunk[] {
    if (chunks.length === 0) {
      this.lastUtilization = {
        totalBudget: tokenBudget,
        budgetUsed: 0,
        chunksIncluded: 0,
        totalChunks: 0,
        utilization: 0,
      };
      return [];
    }

    // Score and sort all chunks
    const scored: ScoredChunk[] = chunks.map((chunk) => ({
      chunk,
      score: this.scoreRelevance(chunk, taskDescription),
      tokens: chunk.tokenEstimate ?? Math.ceil(chunk.content.length / 4),
    }));

    scored.sort((a, b) => b.score - a.score);

    // Greedily fill the budget
    const selected: ContextChunk[] = [];
    let usedTokens = 0;

    for (const item of scored) {
      if (usedTokens + item.tokens <= tokenBudget) {
        selected.push(item.chunk);
        usedTokens += item.tokens;
      }
    }

    this.lastUtilization = {
      totalBudget: tokenBudget,
      budgetUsed: usedTokens,
      chunksIncluded: selected.length,
      totalChunks: chunks.length,
      utilization: tokenBudget > 0 ? usedTokens / tokenBudget : 0,
    };

    logger.debug(
      {
        totalChunks: chunks.length,
        selected: selected.length,
        budgetUsed: usedTokens,
        tokenBudget,
        utilization: this.lastUtilization.utilization.toFixed(3),
      },
      "Context assembled"
    );

    return selected;
  }

  /**
   * Returns how well the context window is being utilized.
   */
  getContextUtilization(): ContextUtilization {
    return (
      this.lastUtilization ?? {
        totalBudget: 0,
        budgetUsed: 0,
        chunksIncluded: 0,
        totalChunks: 0,
        utilization: 0,
      }
    );
  }

  // -----------------------------------------------------------------------
  // Scoring Heuristics
  // -----------------------------------------------------------------------

  private keywordOverlap(content: string, query: string): number {
    const queryWords = new Set(
      query
        .toLowerCase()
        .split(WHITESPACE_RE)
        .filter((w) => w.length > 2)
    );
    if (queryWords.size === 0) {
      return 0;
    }

    const contentLower = content.toLowerCase();
    let matches = 0;
    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        matches++;
      }
    }
    return matches / queryWords.size;
  }

  private pathRelevance(filePath: string, query: string): number {
    const queryWords = query
      .toLowerCase()
      .split(WHITESPACE_RE)
      .filter((w) => w.length > 2);
    const pathLower = filePath.toLowerCase();

    let score = 0;
    for (const word of queryWords) {
      if (pathLower.includes(word)) {
        score += 0.3;
      }
    }
    return Math.min(1, score);
  }

  private importProximity(content: string, query: string): number {
    const queryWords = new Set(
      query
        .toLowerCase()
        .split(WHITESPACE_RE)
        .filter((w) => w.length > 2)
    );

    const importRegex = new RegExp(IMPORT_RE.source, "g");
    let match = importRegex.exec(content);
    let importMatches = 0;
    let totalImports = 0;

    while (match !== null) {
      totalImports++;
      const importPath = (match[1] ?? "").toLowerCase();
      for (const word of queryWords) {
        if (importPath.includes(word)) {
          importMatches++;
          break;
        }
      }
      match = importRegex.exec(content);
    }

    return totalImports > 0 ? importMatches / totalImports : 0;
  }

  private callChainDistance(content: string, query: string): number {
    const queryWords = new Set(
      query
        .toLowerCase()
        .split(WHITESPACE_RE)
        .filter((w) => w.length > 2)
    );

    const callRegex = new RegExp(CALL_RE.source, "g");
    let match = callRegex.exec(content);
    let callMatches = 0;
    let totalCalls = 0;

    while (match !== null) {
      totalCalls++;
      const funcName = (match[1] ?? "").toLowerCase();
      for (const word of queryWords) {
        if (funcName.includes(word)) {
          callMatches++;
          break;
        }
      }
      match = callRegex.exec(content);
    }

    return totalCalls > 0 ? callMatches / Math.min(totalCalls, 20) : 0;
  }
}
