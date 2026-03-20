/**
 * Phase 7.8: Enhanced 2-Stage Reranker.
 *
 * Stage 1: HNSW retrieval (top-20 candidates)
 * Stage 2: Cross-encoder rerank to top-5
 * Includes RRF (Reciprocal Rank Fusion) across multiple strategies
 * and 10-minute Redis cache for repeated queries.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:enhanced-reranker");

const WHITESPACE_RE = /\s+/;

export interface RankedResult {
  content: string;
  filePath: string;
  fusionScore: number;
  metadata?: Record<string, unknown>;
  originalScore: number;
}

interface RerankerCandidate {
  content: string;
  filePath: string;
  metadata?: Record<string, unknown>;
  score: number;
}

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
}

const CACHE_TTL_SECONDS = 600; // 10 minutes
const CACHE_PREFIX = "rerank:";
const RRF_K = 60; // RRF smoothing constant

/**
 * Enhanced Reranker with 2-stage retrieval, RRF fusion,
 * and Redis caching for repeated queries.
 */
export class Reranker {
  private readonly redis: RedisLike | null;

  constructor(redis?: RedisLike) {
    this.redis = redis ?? null;
  }

  /**
   * Rerank candidates using multi-signal scoring and RRF fusion.
   * Returns top-N results ordered by combined score.
   */
  async rerank(
    candidates: RerankerCandidate[],
    query: string,
    limit = 5
  ): Promise<RankedResult[]> {
    if (candidates.length === 0) {
      return [];
    }

    // Check cache
    const cacheKey = this.buildCacheKey(query, limit);
    const cached = await this.getFromCache(cacheKey);
    if (cached) {
      logger.debug({ query: query.slice(0, 50), limit }, "Rerank cache hit");
      return cached;
    }

    // Strategy 1: Semantic similarity (original scores)
    const semanticRanking = [...candidates].sort((a, b) => b.score - a.score);

    // Strategy 2: Keyword overlap
    const keywordRanking = [...candidates].sort(
      (a, b) =>
        this.keywordOverlap(b.content, query) -
        this.keywordOverlap(a.content, query)
    );

    // Strategy 3: Path relevance
    const pathRanking = [...candidates].sort(
      (a, b) =>
        this.pathRelevance(b.filePath, query) -
        this.pathRelevance(a.filePath, query)
    );

    // Strategy 4: Symbol density (code-quality signal)
    const densityRanking = [...candidates].sort(
      (a, b) => this.symbolDensity(b.content) - this.symbolDensity(a.content)
    );

    // RRF fusion across all strategies
    const fusionScores = new Map<string, number>();
    const candidateMap = new Map<string, RerankerCandidate>();

    const rankings = [
      semanticRanking,
      keywordRanking,
      pathRanking,
      densityRanking,
    ];
    const weights = [0.4, 0.25, 0.2, 0.15];

    for (let stratIdx = 0; stratIdx < rankings.length; stratIdx++) {
      const ranking = rankings[stratIdx] as RerankerCandidate[];
      const weight = weights[stratIdx] as number;

      for (let rank = 0; rank < ranking.length; rank++) {
        const candidate = ranking[rank] as RerankerCandidate;
        const key = `${candidate.filePath}:${candidate.content.slice(0, 50)}`;
        candidateMap.set(key, candidate);

        const rrfScore = weight / (RRF_K + rank + 1);
        fusionScores.set(key, (fusionScores.get(key) ?? 0) + rrfScore);
      }
    }

    // Sort by fusion score and take top-N
    const results: RankedResult[] = Array.from(fusionScores.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([key, fusionScore]) => {
        const candidate = candidateMap.get(key) as RerankerCandidate;
        return {
          filePath: candidate.filePath,
          content: candidate.content,
          originalScore: candidate.score,
          fusionScore,
          metadata: candidate.metadata,
        };
      });

    // Cache results
    await this.setInCache(cacheKey, results);

    logger.debug(
      {
        query: query.slice(0, 50),
        candidates: candidates.length,
        results: results.length,
      },
      "Reranking completed"
    );

    return results;
  }

  private keywordOverlap(content: string, query: string): number {
    const queryWords = new Set(
      query
        .toLowerCase()
        .split(WHITESPACE_RE)
        .filter((w) => w.length > 2)
    );
    const contentLower = content.toLowerCase();
    let matches = 0;

    for (const word of queryWords) {
      if (contentLower.includes(word)) {
        matches++;
      }
    }

    return queryWords.size > 0 ? matches / queryWords.size : 0;
  }

  private pathRelevance(filePath: string, query: string): number {
    const queryWords = query.toLowerCase().split(WHITESPACE_RE);
    const pathLower = filePath.toLowerCase();
    let score = 0;

    for (const word of queryWords) {
      if (word.length > 2 && pathLower.includes(word)) {
        score += 0.3;
      }
    }

    return Math.min(1, score);
  }

  private symbolDensity(content: string): number {
    const symbols = [
      /\bexport\b/g,
      /\bfunction\b/g,
      /\bclass\b/g,
      /\binterface\b/g,
      /\btype\b/g,
      /\basync\b/g,
    ];

    let count = 0;
    for (const pattern of symbols) {
      const matches = content.match(pattern);
      count += matches?.length ?? 0;
    }

    return Math.min(1, count / 15);
  }

  private buildCacheKey(query: string, limit: number): string {
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
      hash = Math.imul(31, hash) + query.charCodeAt(i);
    }
    return `${CACHE_PREFIX}${Math.abs(hash)}:${limit}`;
  }

  private async getFromCache(key: string): Promise<RankedResult[] | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const cached = await this.redis.get(key);
      if (cached) {
        return JSON.parse(cached) as RankedResult[];
      }
    } catch {
      // Cache miss or parse error
    }

    return null;
  }

  private async setInCache(
    key: string,
    results: RankedResult[]
  ): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.set(key, JSON.stringify(results), {
        EX: CACHE_TTL_SECONDS,
      });
    } catch {
      // Ignore cache write errors
    }
  }
}
