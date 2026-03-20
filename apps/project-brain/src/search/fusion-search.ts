/**
 * Fusion Search Engine with adaptive strategy weighting.
 *
 * Combines BM25, vector, and graph search using weighted RRF.
 * Enhanced with query classification, post-fusion reranking, and quality metrics.
 */

import { createLogger } from "@prometheus/logger";
import { KnowledgeGraphLayer } from "../layers/knowledge-graph";
import type { SemanticLayer } from "../layers/semantic";
import { BM25Search } from "./bm25-search";
import { Reranker } from "./reranker";

const logger = createLogger("project-brain:fusion-search");

const RRF_K = 60;
const WHITESPACE_SPLIT_RE = /\s+/;

export type SearchStrategy = "bm25" | "vector" | "graph";
export type QueryType = "keyword" | "semantic" | "structural" | "hybrid";

export interface FusionResult {
  content: string;
  filePath: string;
  score: number;
  sources: string[];
}

export interface SearchQualityMetrics {
  durationMs: number;
  overlapCount: number;
  queryType: QueryType;
  rerankerApplied: boolean;
  resultCount: number;
  strategyCounts: Record<string, number>;
  strategyDurations: Record<string, number>;
  strategyWeights: Record<string, number>;
  totalCandidates: number;
}

export interface FusionSearchOptions {
  limit?: number;
  rerank?: boolean;
  strategies?: SearchStrategy[];
  trackMetrics?: boolean;
  weights?: Partial<Record<SearchStrategy, number>>;
}

export interface FusionSearchResult {
  metrics?: SearchQualityMetrics;
  results: FusionResult[];
}

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
}

const KEYWORD_INDICATORS =
  /^[A-Z][\w.]+$|^["']|import\s|from\s|require\(|\.ts$|\.js$|\.py$/i;
const STRUCTURAL_INDICATORS =
  /\bcalls?\b|\bimports?\b|\bextends\b|\bdepend|\brelat|\bgraph\b|\btree\b|\bhierarch/i;
const SEMANTIC_INDICATORS =
  /\bhow\b|\bwhat\b|\bwhy\b|\bexplain\b|\bdescribe\b|\bunderstand|\bconcept|\bwork/i;

const QUERY_TYPE_WEIGHTS: Record<QueryType, Record<SearchStrategy, number>> = {
  keyword: { bm25: 1.0, vector: 0.4, graph: 0.3 },
  semantic: { bm25: 0.4, vector: 1.0, graph: 0.5 },
  structural: { bm25: 0.3, vector: 0.5, graph: 1.0 },
  hybrid: { bm25: 0.7, vector: 0.7, graph: 0.5 },
};

export class FusionSearch {
  private readonly semantic: SemanticLayer;
  private readonly bm25: BM25Search;
  private readonly graph: KnowledgeGraphLayer;
  private readonly reranker: Reranker;

  constructor(semantic: SemanticLayer, redis?: RedisLike) {
    this.semantic = semantic;
    this.bm25 = new BM25Search();
    this.graph = new KnowledgeGraphLayer();
    this.reranker = new Reranker(redis);
  }

  async search(
    projectId: string,
    query: string,
    options?: FusionSearchOptions
  ): Promise<FusionSearchResult>;
  async search(
    projectId: string,
    query: string,
    strategies?: SearchStrategy[],
    limit?: number
  ): Promise<FusionResult[]>;
  async search(
    projectId: string,
    query: string,
    strategiesOrOptions?: SearchStrategy[] | FusionSearchOptions,
    legacyLimit?: number
  ): Promise<FusionResult[] | FusionSearchResult> {
    if (Array.isArray(strategiesOrOptions) || legacyLimit !== undefined) {
      const strategies = Array.isArray(strategiesOrOptions)
        ? strategiesOrOptions
        : undefined;
      const result = await this.searchInternal(projectId, query, {
        strategies,
        limit: legacyLimit ?? 20,
      });
      return result.results;
    }
    return this.searchInternal(projectId, query, strategiesOrOptions ?? {});
  }

  private async searchInternal(
    projectId: string,
    query: string,
    options: FusionSearchOptions
  ): Promise<FusionSearchResult> {
    const start = performance.now();
    const limit = options.limit ?? 20;
    const queryType = this.classifyQuery(query);
    const activeStrategies = options.strategies ?? ["bm25", "vector", "graph"];
    const maxPerMethod = limit * 2;
    const baseWeights = QUERY_TYPE_WEIGHTS[queryType];
    const weights: Record<string, number> = {};
    for (const strategy of activeStrategies) {
      weights[strategy] =
        options.weights?.[strategy] ?? baseWeights[strategy] ?? 0.5;
    }

    const strategyDurations: Record<string, number> = {};
    const strategyCounts: Record<string, number> = {};

    const strategyPromises = activeStrategies.map(async (strategy) => {
      const stratStart = performance.now();
      try {
        const results = await this.runStrategy(
          projectId,
          query,
          strategy,
          maxPerMethod
        );
        strategyDurations[strategy] = Math.round(
          performance.now() - stratStart
        );
        strategyCounts[strategy] = results.length;
        return { method: strategy, results };
      } catch (error) {
        strategyDurations[strategy] = Math.round(
          performance.now() - stratStart
        );
        strategyCounts[strategy] = 0;
        logger.warn(
          { strategy, error: String(error) },
          `${strategy} search strategy failed`
        );
        return null;
      }
    });

    const settledResults = await Promise.all(strategyPromises);
    const methodResults: Array<{ method: string; results: RankedItem[] }> = [];
    for (const result of settledResults) {
      if (result && result.results.length > 0) {
        methodResults.push(result);
      }
    }

    const fused = this.applyWeightedRRF(methodResults, weights, limit * 2);
    const totalCandidates = methodResults.reduce(
      (sum, m) => sum + m.results.length,
      0
    );
    const overlapCount = this.countOverlaps(methodResults);

    let finalResults = fused;
    let rerankerApplied = false;
    if (
      options.rerank !== false &&
      fused.length > 0 &&
      process.env.VOYAGE_API_KEY
    ) {
      try {
        const reranked = await this.reranker.rerank(
          fused.map((r) => ({
            content: r.content,
            filePath: r.filePath,
            score: r.score,
          })),
          query,
          limit
        );
        finalResults = reranked.map((r) => ({
          filePath: r.filePath,
          content: r.content,
          score: Math.round(r.fusionScore * 10_000) / 10_000,
          sources: fused.find(
            (f) =>
              f.filePath === r.filePath &&
              f.content.slice(0, 50) === r.content.slice(0, 50)
          )?.sources ?? ["reranked"],
        }));
        rerankerApplied = true;
      } catch (error) {
        logger.warn(
          { error: String(error) },
          "Post-fusion reranking failed, using RRF order"
        );
      }
    }

    const results = finalResults.slice(0, limit);
    const elapsed = Math.round(performance.now() - start);
    logger.info(
      {
        projectId,
        query: query.slice(0, 80),
        queryType,
        resultCount: results.length,
        totalCandidates,
        rerankerApplied,
        durationMs: elapsed,
      },
      "Fusion search completed"
    );

    const metrics: SearchQualityMetrics | undefined = options.trackMetrics
      ? {
          durationMs: elapsed,
          queryType,
          strategyCounts,
          strategyWeights: weights,
          strategyDurations,
          overlapCount,
          totalCandidates,
          resultCount: results.length,
          rerankerApplied,
        }
      : undefined;

    return { results, metrics };
  }

  classifyQuery(query: string): QueryType {
    const isKeyword = KEYWORD_INDICATORS.test(query);
    const isStructural = STRUCTURAL_INDICATORS.test(query);
    const isSemantic = SEMANTIC_INDICATORS.test(query);
    const signalCount =
      (isKeyword ? 1 : 0) + (isStructural ? 1 : 0) + (isSemantic ? 1 : 0);
    if (signalCount >= 2) {
      return "hybrid";
    }
    if (isKeyword) {
      return "keyword";
    }
    if (isStructural) {
      return "structural";
    }
    if (isSemantic) {
      return "semantic";
    }
    const wordCount = query.trim().split(WHITESPACE_SPLIT_RE).length;
    if (wordCount <= 2) {
      return "keyword";
    }
    if (wordCount >= 5) {
      return "semantic";
    }
    return "hybrid";
  }

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

  private applyWeightedRRF(
    methodResults: Array<{ method: string; results: RankedItem[] }>,
    weights: Record<string, number>,
    limit: number
  ): FusionResult[] {
    const docScores = new Map<
      string,
      { filePath: string; content: string; score: number; sources: Set<string> }
    >();
    for (const { method, results } of methodResults) {
      const weight = weights[method] ?? 1.0;
      for (let rank = 0; rank < results.length; rank++) {
        const item = results[rank];
        if (!item) {
          continue;
        }
        const rrfScore = weight / (RRF_K + rank + 1);
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

  private countOverlaps(
    methodResults: Array<{ method: string; results: RankedItem[] }>
  ): number {
    const docSources = new Map<string, number>();
    for (const { results } of methodResults) {
      for (const item of results) {
        const key = `${item.filePath}:${item.content.slice(0, 60)}`;
        docSources.set(key, (docSources.get(key) ?? 0) + 1);
      }
    }
    let overlaps = 0;
    for (const count of docSources.values()) {
      if (count > 1) {
        overlaps++;
      }
    }
    return overlaps;
  }
}

interface RankedItem {
  content: string;
  filePath: string;
  id: string;
  score: number;
}
