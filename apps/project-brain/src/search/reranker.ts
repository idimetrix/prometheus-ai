/**
 * Phase 7.8: Enhanced 2-Stage Reranker with Cross-Encoder API.
 *
 * Stage 1: Local multi-signal RRF scoring (keyword, path, symbol density)
 * Stage 2: Cross-encoder rerank via Voyage AI rerank-2.5 API on top-50
 * Includes Redis caching for repeated queries.
 * Fallback to RRF scores if API unavailable.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:enhanced-reranker");

const WHITESPACE_RE = /\s+/;
const VOYAGE_API_BASE = "https://api.voyageai.com/v1";
const MAX_CROSS_ENCODER_CANDIDATES = 50;

export interface RankedResult {
  content: string;
  crossEncoderReranked?: boolean;
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

interface VoyageRerankResponse {
  data: Array<{ index: number; relevance_score: number }>;
  model: string;
  usage?: { total_tokens: number };
}

const CACHE_TTL_SECONDS = 600;
const CACHE_PREFIX = "rerank:";
const RRF_K = 60;

export interface CrossEncoderConfig {
  apiKey?: string;
  maxCandidates?: number;
  model?: string;
  timeoutMs?: number;
}

export class Reranker {
  private readonly redis: RedisLike | null;
  private readonly crossEncoderConfig: Required<CrossEncoderConfig>;

  constructor(redis?: RedisLike, crossEncoderConfig?: CrossEncoderConfig) {
    this.redis = redis ?? null;
    this.crossEncoderConfig = {
      apiKey: crossEncoderConfig?.apiKey ?? process.env.VOYAGE_API_KEY ?? "",
      model: crossEncoderConfig?.model ?? "rerank-2.5",
      maxCandidates:
        crossEncoderConfig?.maxCandidates ?? MAX_CROSS_ENCODER_CANDIDATES,
      timeoutMs: crossEncoderConfig?.timeoutMs ?? 15_000,
    };
  }

  async rerank(
    candidates: RerankerCandidate[],
    query: string,
    limit = 5
  ): Promise<RankedResult[]> {
    if (candidates.length === 0) {
      return [];
    }

    const cacheKey = this.buildCacheKey(query, limit, candidates.length);
    const cached = await this.getFromCache(cacheKey);
    if (cached) {
      logger.debug({ query: query.slice(0, 50), limit }, "Rerank cache hit");
      return cached;
    }

    const rrfResults = this.localRRFRerank(candidates, query);
    const topCandidatesForCE = rrfResults.slice(
      0,
      this.crossEncoderConfig.maxCandidates
    );
    let finalResults: RankedResult[];

    if (this.crossEncoderConfig.apiKey) {
      finalResults = await this.crossEncoderRerank(
        topCandidatesForCE,
        query,
        limit
      );
    } else {
      finalResults = topCandidatesForCE.slice(0, limit);
    }

    await this.setInCache(cacheKey, finalResults);

    logger.debug(
      {
        query: query.slice(0, 50),
        candidates: candidates.length,
        results: finalResults.length,
        crossEncoder: finalResults.some((r) => r.crossEncoderReranked),
      },
      "Reranking completed"
    );

    return finalResults;
  }

  private localRRFRerank(
    candidates: RerankerCandidate[],
    query: string
  ): RankedResult[] {
    const semanticRanking = [...candidates].sort((a, b) => b.score - a.score);
    const keywordRanking = [...candidates].sort(
      (a, b) =>
        this.keywordOverlap(b.content, query) -
        this.keywordOverlap(a.content, query)
    );
    const pathRanking = [...candidates].sort(
      (a, b) =>
        this.pathRelevance(b.filePath, query) -
        this.pathRelevance(a.filePath, query)
    );
    const densityRanking = [...candidates].sort(
      (a, b) => this.symbolDensity(b.content) - this.symbolDensity(a.content)
    );

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
        fusionScores.set(
          key,
          (fusionScores.get(key) ?? 0) + weight / (RRF_K + rank + 1)
        );
      }
    }

    return Array.from(fusionScores.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([key, fusionScore]) => {
        const candidate = candidateMap.get(key) as RerankerCandidate;
        return {
          filePath: candidate.filePath,
          content: candidate.content,
          originalScore: candidate.score,
          fusionScore,
          metadata: candidate.metadata,
          crossEncoderReranked: false,
        };
      });
  }

  private async crossEncoderRerank(
    candidates: RankedResult[],
    query: string,
    limit: number
  ): Promise<RankedResult[]> {
    try {
      const docTexts = candidates.map(
        (d) => `${d.filePath}\n${d.content.slice(0, 1000)}`
      );
      const response = await fetch(`${VOYAGE_API_BASE}/rerank`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.crossEncoderConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: this.crossEncoderConfig.model,
          query,
          documents: docTexts,
          top_k: limit,
        }),
        signal: AbortSignal.timeout(this.crossEncoderConfig.timeoutMs),
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status },
          "Voyage rerank API returned error, falling back to RRF scores"
        );
        return candidates.slice(0, limit);
      }

      const data = (await response.json()) as VoyageRerankResponse;
      if (data.usage?.total_tokens) {
        logger.debug(
          { tokens: data.usage.total_tokens, model: data.model },
          "Voyage rerank API usage"
        );
      }

      return data.data.map((item) => {
        const original = candidates[item.index] as RankedResult;
        return {
          ...original,
          fusionScore: item.relevance_score * 0.7 + original.fusionScore * 0.3,
          crossEncoderReranked: true,
          metadata: {
            ...original.metadata,
            crossEncoderScore: item.relevance_score,
          },
        };
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { error: msg },
        "Cross-encoder reranking failed, falling back to RRF scores"
      );
      return candidates.slice(0, limit);
    }
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

  private buildCacheKey(
    query: string,
    limit: number,
    candidateCount: number
  ): string {
    const input = `${query}:${candidateCount}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = Math.imul(31, hash) + input.charCodeAt(i);
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
      /* cache miss */
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
      /* ignore */
    }
  }
}
