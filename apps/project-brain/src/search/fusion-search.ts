/**
 * Fusion Search Engine.
 *
 * Combines BM25 keyword search, vector cosine similarity search,
 * and knowledge graph traversal using Reciprocal Rank Fusion (RRF)
 * to produce high-quality search results.
 *
 * RRF formula: score(doc) = sum(1 / (60 + rank_i)) across all strategies
 */

import { createLogger } from "@prometheus/logger";
import { KnowledgeGraphLayer } from "../layers/knowledge-graph";
import type { SemanticLayer } from "../layers/semantic";
import { BM25Search } from "./bm25-search";

const logger = createLogger("project-brain:fusion-search");

/** RRF constant that controls lower-ranked result weight. */
const RRF_K = 60;

/**
 * Available search strategies for the fusion engine.
 */
export type SearchStrategy = "bm25" | "vector" | "graph";

/**
 * A single result from the fusion search.
 */
export interface FusionResult {
  /** The matching content snippet */
  content: string;
  /** File path relative to project root */
  filePath: string;
  /** Combined RRF score */
  score: number;
  /** Which search strategies contributed to this result */
  sources: string[];
}

/**
 * Fuses results from multiple search strategies using Reciprocal Rank Fusion.
 *
 * Strategies:
 * - **bm25**: PostgreSQL full-text search (keyword matching)
 * - **vector**: pgvector cosine similarity (semantic matching)
 * - **graph**: Knowledge graph traversal (structural matching)
 *
 * @example
 * ```ts
 * const fusion = new FusionSearch(semanticLayer);
 * const results = await fusion.search("proj_123", "authentication middleware");
 * for (const r of results) {
 *   console.log(`${r.filePath} (${r.score.toFixed(4)}): ${r.sources.join(", ")}`);
 * }
 * ```
 */
export class FusionSearch {
  private readonly semantic: SemanticLayer;
  private readonly bm25: BM25Search;
  private readonly graph: KnowledgeGraphLayer;

  constructor(semantic: SemanticLayer) {
    this.semantic = semantic;
    this.bm25 = new BM25Search();
    this.graph = new KnowledgeGraphLayer();
  }

  /**
   * Execute a fused search across multiple strategies.
   *
   * @param projectId - The project to search within
   * @param query - Natural language or keyword query
   * @param strategies - Which strategies to use (default: all three)
   * @param limit - Maximum number of results (default: 20)
   * @returns Fused and ranked search results
   */
  async search(
    projectId: string,
    query: string,
    strategies?: SearchStrategy[],
    limit = 20
  ): Promise<FusionResult[]> {
    const start = performance.now();
    const activeStrategies = strategies ?? ["bm25", "vector", "graph"];
    const maxPerMethod = limit * 2; // Fetch more per method for better fusion

    // Run all active strategies in parallel
    const strategyResults = await Promise.allSettled(
      activeStrategies.map((strategy) =>
        this.runStrategy(projectId, query, strategy, maxPerMethod)
      )
    );

    // Collect successful results
    const methodResults: Array<{ method: string; results: RankedItem[] }> = [];

    for (let i = 0; i < activeStrategies.length; i++) {
      const strategyName = activeStrategies[i];
      const result = strategyResults[i];

      if (result && result.status === "fulfilled") {
        methodResults.push({
          method: strategyName ?? "unknown",
          results: result.value,
        });
      } else if (result && result.status === "rejected") {
        logger.warn(
          {
            strategy: strategyName,
            error: String((result as PromiseRejectedResult).reason),
          },
          `${strategyName} search strategy failed`
        );
      }
    }

    // Apply RRF fusion
    const fused = this.applyRRF(methodResults, limit);

    const elapsed = Math.round(performance.now() - start);

    logger.info(
      {
        projectId,
        query: query.slice(0, 80),
        strategies: activeStrategies,
        resultCount: fused.length,
        durationMs: elapsed,
      },
      "Fusion search completed"
    );

    return fused;
  }

  /**
   * Run a single search strategy.
   */
  private async runStrategy(
    projectId: string,
    query: string,
    strategy: SearchStrategy,
    limit: number
  ): Promise<RankedItem[]> {
    switch (strategy) {
      case "bm25": {
        const results = await this.bm25.search(projectId, query, limit);
        return results.map((r) => ({
          id: `bm25:${r.filePath}:${r.content.slice(0, 40)}`,
          filePath: r.filePath,
          content: r.content,
          score: r.score,
        }));
      }

      case "vector": {
        const results = await this.semantic.search(projectId, query, limit);
        return results.map((r) => ({
          id: `vector:${r.filePath}:${r.content.slice(0, 40)}`,
          filePath: r.filePath,
          content: r.content,
          score: r.score,
        }));
      }

      case "graph": {
        const graphResult = await this.graph.query(projectId, query);
        return graphResult.nodes.map((node) => ({
          id: `graph:${node.id}`,
          filePath: node.filePath,
          content: `${node.type}: ${node.name}`,
          score: 1,
        }));
      }

      default:
        return [];
    }
  }

  /**
   * Apply Reciprocal Rank Fusion across multiple method results.
   *
   * Formula: score(doc) = sum(1 / (k + rank_i))
   * where k = 60 and rank_i is the 1-indexed rank in each method.
   */
  private applyRRF(
    methodResults: Array<{ method: string; results: RankedItem[] }>,
    limit: number
  ): FusionResult[] {
    const docScores = new Map<
      string,
      {
        filePath: string;
        content: string;
        score: number;
        sources: Set<string>;
      }
    >();

    for (const { method, results } of methodResults) {
      for (let rank = 0; rank < results.length; rank++) {
        const item = results[rank];
        if (!item) {
          continue;
        }

        const rrfScore = 1 / (RRF_K + rank + 1);
        const dedupeKey = `${item.filePath}:${item.content.slice(0, 60)}`;
        const existing = docScores.get(dedupeKey);

        if (existing) {
          existing.score += rrfScore;
          existing.sources.add(method);
        } else {
          docScores.set(dedupeKey, {
            filePath: item.filePath,
            content: item.content,
            score: rrfScore,
            sources: new Set([method]),
          });
        }
      }
    }

    return Array.from(docScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((doc) => ({
        filePath: doc.filePath,
        content: doc.content,
        score: Math.round(doc.score * 10_000) / 10_000,
        sources: Array.from(doc.sources),
      }));
  }
}

/**
 * Internal ranked item for fusion.
 */
interface RankedItem {
  content: string;
  filePath: string;
  id: string;
  score: number;
}
