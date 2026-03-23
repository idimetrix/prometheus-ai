/**
 * Semantic Search with Reranking
 *
 * Reranks search results using cross-encoder scoring for improved
 * relevance. Falls back to keyword overlap when the embedding service
 * is unavailable.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:semantic-reranker");

const WHITESPACE_RE = /\s+/;
const VOYAGE_API_BASE = "https://api.voyageai.com/v1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchResult {
  content: string;
  filePath: string;
  metadata?: Record<string, unknown>;
  score: number;
}

export interface RerankedResult extends SearchResult {
  originalRank: number;
  rerankedScore: number;
}

interface VoyageRerankItem {
  index: number;
  relevance_score: number;
}

// ---------------------------------------------------------------------------
// SemanticReranker
// ---------------------------------------------------------------------------

export class SemanticReranker {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options?: {
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
  }) {
    this.apiKey = options?.apiKey ?? process.env.VOYAGE_API_KEY ?? "";
    this.model = options?.model ?? "rerank-2.5";
    this.timeoutMs = options?.timeoutMs ?? 15_000;
  }

  /**
   * Rerank search results by relevance to the query.
   * Uses cross-encoder scoring when available, falls back to keyword overlap.
   */
  async rerank(
    query: string,
    results: SearchResult[],
    topK = 10
  ): Promise<RerankedResult[]> {
    if (results.length === 0) {
      return [];
    }

    if (this.apiKey) {
      try {
        return await this.crossEncoderRerank(query, results, topK);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { error: msg },
          "Cross-encoder reranking failed, falling back to keyword overlap"
        );
      }
    }

    return this.keywordRerank(query, results, topK);
  }

  /**
   * Get reranked results using the best available method.
   */
  getRerankedResults(
    query: string,
    candidates: SearchResult[]
  ): Promise<RerankedResult[]> {
    return this.rerank(query, candidates);
  }

  // -----------------------------------------------------------------------
  // Cross-Encoder Reranking
  // -----------------------------------------------------------------------

  private async crossEncoderRerank(
    query: string,
    results: SearchResult[],
    topK: number
  ): Promise<RerankedResult[]> {
    const documents = results.map(
      (r) => `${r.filePath}\n${r.content.slice(0, 1000)}`
    );

    const response = await fetch(`${VOYAGE_API_BASE}/rerank`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        query,
        documents,
        top_k: topK,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Voyage rerank API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      data: VoyageRerankItem[];
    };

    const reranked: RerankedResult[] = data.data.map((item) => {
      const original = results[item.index] as SearchResult;
      return {
        ...original,
        originalRank: item.index,
        rerankedScore: item.relevance_score,
      };
    });

    reranked.sort((a, b) => b.rerankedScore - a.rerankedScore);

    logger.debug(
      {
        query: query.slice(0, 50),
        candidates: results.length,
        returned: reranked.length,
      },
      "Cross-encoder reranking complete"
    );

    return reranked;
  }

  // -----------------------------------------------------------------------
  // Keyword Fallback Reranking
  // -----------------------------------------------------------------------

  private keywordRerank(
    query: string,
    results: SearchResult[],
    topK: number
  ): RerankedResult[] {
    const queryWords = new Set(
      query
        .toLowerCase()
        .split(WHITESPACE_RE)
        .filter((w) => w.length > 2)
    );

    const scored: RerankedResult[] = results.map((result, idx) => {
      const contentLower = result.content.toLowerCase();
      const pathLower = result.filePath.toLowerCase();

      let matches = 0;
      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          matches++;
        }
        if (pathLower.includes(word)) {
          matches += 0.5;
        }
      }

      const keywordScore = queryWords.size > 0 ? matches / queryWords.size : 0;
      const combinedScore = result.score * 0.4 + keywordScore * 0.6;

      return {
        ...result,
        originalRank: idx,
        rerankedScore: combinedScore,
      };
    });

    scored.sort((a, b) => b.rerankedScore - a.rerankedScore);

    logger.debug(
      {
        query: query.slice(0, 50),
        candidates: results.length,
        returned: Math.min(topK, scored.length),
        method: "keyword-fallback",
      },
      "Keyword reranking complete"
    );

    return scored.slice(0, topK);
  }
}
