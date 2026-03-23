/**
 * Reranker Layer - Multi-signal reranking with optional Voyage AI cross-encoder.
 *
 * Signals: Cosine similarity (40%), Path relevance (20%), Recency (15%),
 * File type match (10%), Symbol density (15%).
 * Enhanced with cross-encoder reranking and Redis caching.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:reranker");

const WHITESPACE_RE = /\s+/;
const EXPORT_RE = /\bexport\b/g;
const FUNCTION_RE = /\bfunction\b/g;
const CLASS_RE = /\bclass\b/g;
const INTERFACE_RE = /\binterface\b/g;
const TYPE_RE = /\btype\b/g;
const CONST_RE = /\bconst\b/g;
const ASYNC_RE = /\basync\b/g;
const VOYAGE_API_BASE = "https://api.voyageai.com/v1";
const RERANK_CACHE_TTL = 600;
const RERANK_CACHE_PREFIX = "layer-rerank:";

export interface RerankableResult {
  content: string;
  filePath: string;
  metadata?: Record<string, unknown>;
  score: number;
}

export interface RerankOptions {
  boostPaths?: string[];
  crossEncoderCandidates?: number;
  excludePaths?: string[];
  fileTypes?: string[];
  recentlyModified?: boolean;
  useCrossEncoder?: boolean;
}

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
}

export class Reranker {
  private readonly redis: RedisLike | null;

  constructor(redis?: RedisLike) {
    this.redis = redis ?? null;
  }

  async rerankAsync(
    results: RerankableResult[],
    query: string,
    options: RerankOptions = {}
  ): Promise<RerankableResult[]> {
    const cacheKey = this.buildCacheKey(query, results.length, options);
    const cached = await this.getFromCache(cacheKey);
    if (cached) {
      logger.debug({ query: query.slice(0, 50) }, "Reranker cache hit");
      return cached;
    }

    let ranked = this.rerank(results, query, options);

    if (options.useCrossEncoder) {
      const candidateCount = options.crossEncoderCandidates ?? 20;
      const topCandidates = ranked.slice(0, candidateCount);
      const rest = ranked.slice(candidateCount);
      const reranked = await this.crossEncoderRerank(topCandidates, query);
      ranked = [...reranked, ...rest];
    }

    await this.setInCache(cacheKey, ranked);
    return ranked;
  }

  rerank(
    results: RerankableResult[],
    query: string,
    options: RerankOptions = {}
  ): RerankableResult[] {
    const scored = results.map((result) => {
      const similarity = result.score * 0.4;
      const pathRelevance =
        this.scorePathRelevance(result.filePath, query, options) * 0.2;
      const recency = this.scoreRecency(result, options) * 0.15;
      const fileType = this.scoreFileType(result.filePath, options) * 0.1;
      const symbolDensity = this.scoreSymbolDensity(result.content) * 0.15;
      return {
        ...result,
        score: similarity + pathRelevance + recency + fileType + symbolDensity,
      };
    });

    const filtered = options.excludePaths
      ? scored.filter(
          (r) => !options.excludePaths?.some((p) => r.filePath.includes(p))
        )
      : scored;

    return filtered.sort((a, b) => b.score - a.score);
  }

  private async crossEncoderRerank(
    results: RerankableResult[],
    query: string
  ): Promise<RerankableResult[]> {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey) {
      logger.debug("VOYAGE_API_KEY not set, skipping cross-encoder reranking");
      return results;
    }
    try {
      const docTexts = results.map(
        (r) => `${r.filePath}\n${r.content.slice(0, 1000)}`
      );
      const response = await fetch(`${VOYAGE_API_BASE}/rerank`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "rerank-2.5",
          query,
          documents: docTexts,
          top_k: results.length,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        logger.warn(
          { status: response.status },
          "Voyage rerank API failed, using local scores"
        );
        return results;
      }
      const data = (await response.json()) as {
        data: Array<{ index: number; relevance_score: number }>;
      };
      return data.data.map((item) => {
        const original = results[item.index] as RerankableResult;
        return {
          ...original,
          score: item.relevance_score * 0.6 + original.score * 0.4,
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
        "Cross-encoder reranking failed, using local scores"
      );
      return results;
    }
  }

  private scorePathRelevance(
    filePath: string,
    query: string,
    options: RerankOptions
  ): number {
    let score = 0;
    const queryWords = query.toLowerCase().split(WHITESPACE_RE);
    const pathLower = filePath.toLowerCase();
    for (const word of queryWords) {
      if (word.length > 2 && pathLower.includes(word)) {
        score += 0.3;
      }
    }
    if (options.boostPaths) {
      for (const boostPath of options.boostPaths) {
        if (filePath.includes(boostPath)) {
          score += 0.4;
          break;
        }
      }
    }
    if (
      !query.toLowerCase().includes("test") &&
      (pathLower.includes("__tests__") ||
        pathLower.includes(".test.") ||
        pathLower.includes(".spec."))
    ) {
      score -= 0.2;
    }
    return Math.min(1, Math.max(0, score));
  }

  private scoreRecency(
    result: RerankableResult,
    options: RerankOptions
  ): number {
    if (!options.recentlyModified) {
      return 0.5;
    }
    const modifiedAt = result.metadata?.modifiedAt;
    if (!modifiedAt) {
      return 0.3;
    }
    const age = Date.now() - new Date(modifiedAt as string).getTime();
    const dayMs = 86_400_000;
    if (age < dayMs) {
      return 1.0;
    }
    if (age < 7 * dayMs) {
      return 0.8;
    }
    if (age < 30 * dayMs) {
      return 0.5;
    }
    return 0.2;
  }

  private scoreFileType(filePath: string, options: RerankOptions): number {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    if (options.fileTypes && options.fileTypes.length > 0) {
      return options.fileTypes.includes(ext) ? 1.0 : 0.3;
    }
    const typeScores: Record<string, number> = {
      ts: 0.9,
      tsx: 0.85,
      js: 0.7,
      jsx: 0.7,
      json: 0.4,
      yaml: 0.4,
      yml: 0.4,
      md: 0.3,
      css: 0.5,
    };
    return typeScores[ext] ?? 0.3;
  }

  private scoreSymbolDensity(content: string): number {
    const symbols = [
      EXPORT_RE,
      FUNCTION_RE,
      CLASS_RE,
      INTERFACE_RE,
      TYPE_RE,
      CONST_RE,
      ASYNC_RE,
    ];
    let count = 0;
    for (const pattern of symbols) {
      count += content.match(pattern)?.length ?? 0;
    }
    return Math.min(1, count / 15);
  }

  private buildCacheKey(
    query: string,
    resultCount: number,
    options: RerankOptions
  ): string {
    const input = `${query}:${resultCount}:${options.useCrossEncoder ?? false}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = Math.imul(31, hash) + input.charCodeAt(i);
    }
    return `${RERANK_CACHE_PREFIX}${Math.abs(hash)}`;
  }

  private async getFromCache(key: string): Promise<RerankableResult[] | null> {
    if (!this.redis) {
      return null;
    }
    try {
      const cached = await this.redis.get(key);
      if (cached) {
        return JSON.parse(cached) as RerankableResult[];
      }
    } catch {
      /* miss */
    }
    return null;
  }

  private async setInCache(
    key: string,
    results: RerankableResult[]
  ): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.set(key, JSON.stringify(results), {
        EX: RERANK_CACHE_TTL,
      });
    } catch {
      /* ignore */
    }
  }
}
