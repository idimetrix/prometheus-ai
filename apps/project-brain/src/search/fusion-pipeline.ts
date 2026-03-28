/**
 * GAP-091: Fusion Search Pipeline
 *
 * Combines BM25 keyword search with semantic vector search using
 * Reciprocal Rank Fusion (RRF) to produce merged, ranked results
 * with relevance scores.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:fusion-pipeline");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FusionSearchResult {
  content: string;
  filePath: string;
  rrfScore: number;
  sources: Array<"bm25" | "vector">;
}

export interface FusionPipelineConfig {
  /** Weight for BM25 results (0-1) */
  bm25Weight: number;
  /** RRF constant k (default 60) */
  k: number;
  /** Maximum results to return */
  maxResults: number;
  /** Weight for vector results (0-1) */
  vectorWeight: number;
}

interface RankedDoc {
  content: string;
  filePath: string;
  rank: number;
  score: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: FusionPipelineConfig = {
  k: 60,
  maxResults: 20,
  bm25Weight: 0.5,
  vectorWeight: 0.5,
};

// ─── BM25 Implementation ─────────────────────────────────────────────────────

interface BM25Document {
  content: string;
  filePath: string;
  length: number;
  termFreqs: Map<string, number>;
}

const WORD_SPLIT_RE = /\W+/;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(WORD_SPLIT_RE)
    .filter((t) => t.length > 1);
}

/**
 * Simple in-memory BM25 index for keyword search.
 */
export class BM25Index {
  private readonly documents: BM25Document[] = [];
  private readonly docFreq = new Map<string, number>();
  private avgDocLength = 0;
  private readonly k1 = 1.2;
  private readonly b = 0.75;

  addDocument(filePath: string, content: string): void {
    const tokens = tokenize(content);
    const termFreqs = new Map<string, number>();

    for (const token of tokens) {
      termFreqs.set(token, (termFreqs.get(token) ?? 0) + 1);
    }

    const seen = new Set<string>();
    for (const token of tokens) {
      if (!seen.has(token)) {
        this.docFreq.set(token, (this.docFreq.get(token) ?? 0) + 1);
        seen.add(token);
      }
    }

    this.documents.push({
      filePath,
      content: content.slice(0, 500),
      termFreqs,
      length: tokens.length,
    });

    // Recalculate average document length
    const totalLength = this.documents.reduce((s, d) => s + d.length, 0);
    this.avgDocLength = totalLength / this.documents.length;
  }

  search(query: string, limit: number): RankedDoc[] {
    const queryTokens = tokenize(query);
    const n = this.documents.length;
    if (n === 0) {
      return [];
    }

    const scores: Array<{ doc: BM25Document; score: number }> = [];

    for (const doc of this.documents) {
      let score = 0;
      for (const term of queryTokens) {
        const tf = doc.termFreqs.get(term) ?? 0;
        const df = this.docFreq.get(term) ?? 0;
        if (tf === 0 || df === 0) {
          continue;
        }

        const idf = Math.log((n - df + 0.5) / (df + 0.5) + 1);
        const tfNorm =
          (tf * (this.k1 + 1)) /
          (tf +
            this.k1 * (1 - this.b + this.b * (doc.length / this.avgDocLength)));
        score += idf * tfNorm;
      }

      if (score > 0) {
        scores.push({ doc, score });
      }
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s, i) => ({
        filePath: s.doc.filePath,
        content: s.doc.content,
        score: s.score,
        rank: i + 1,
      }));
  }
}

// ─── Vector Search Stub ──────────────────────────────────────────────────────

export type VectorSearchFn = (
  query: string,
  limit: number
) => Promise<RankedDoc[]>;

// ─── Fusion Pipeline ─────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion pipeline that combines BM25 keyword search
 * and semantic vector search into a single ranked result set.
 */
export class FusionSearchPipeline {
  private readonly config: FusionPipelineConfig;
  private readonly bm25: BM25Index;
  private readonly vectorSearch: VectorSearchFn;

  constructor(
    bm25: BM25Index,
    vectorSearch: VectorSearchFn,
    config?: Partial<FusionPipelineConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.bm25 = bm25;
    this.vectorSearch = vectorSearch;
  }

  /**
   * Execute the fusion search pipeline.
   *
   * 1. Run BM25 keyword search and vector search in parallel
   * 2. Apply Reciprocal Rank Fusion to merge results
   * 3. Return ranked results with relevance scores
   */
  async search(query: string): Promise<FusionSearchResult[]> {
    const startMs = Date.now();
    const fetchLimit = this.config.maxResults * 3;

    // Run both searches in parallel
    const [bm25Results, vectorResults] = await Promise.all([
      Promise.resolve(this.bm25.search(query, fetchLimit)),
      this.vectorSearch(query, fetchLimit),
    ]);

    logger.debug(
      {
        bm25Count: bm25Results.length,
        vectorCount: vectorResults.length,
        query: query.slice(0, 80),
      },
      "Search results fetched"
    );

    // Apply RRF
    const merged = this.applyRRF(bm25Results, vectorResults);

    const durationMs = Date.now() - startMs;
    logger.info(
      {
        resultCount: merged.length,
        durationMs,
        query: query.slice(0, 80),
      },
      "Fusion search completed"
    );

    return merged;
  }

  /**
   * Apply Reciprocal Rank Fusion to merge two ranked result sets.
   *
   * RRF score = sum( weight / (k + rank) ) for each source
   */
  private applyRRF(
    bm25Results: RankedDoc[],
    vectorResults: RankedDoc[]
  ): FusionSearchResult[] {
    const { k, bm25Weight, vectorWeight, maxResults } = this.config;
    const scoreMap = new Map<
      string,
      {
        content: string;
        filePath: string;
        score: number;
        sources: Array<"bm25" | "vector">;
      }
    >();

    // Add BM25 results with weighted RRF scores
    for (const doc of bm25Results) {
      const rrfScore = bm25Weight / (k + doc.rank);
      const existing = scoreMap.get(doc.filePath);

      if (existing) {
        existing.score += rrfScore;
        if (!existing.sources.includes("bm25")) {
          existing.sources.push("bm25");
        }
      } else {
        scoreMap.set(doc.filePath, {
          filePath: doc.filePath,
          content: doc.content,
          score: rrfScore,
          sources: ["bm25"],
        });
      }
    }

    // Add vector results with weighted RRF scores
    for (const doc of vectorResults) {
      const rrfScore = vectorWeight / (k + doc.rank);
      const existing = scoreMap.get(doc.filePath);

      if (existing) {
        existing.score += rrfScore;
        if (!existing.sources.includes("vector")) {
          existing.sources.push("vector");
        }
      } else {
        scoreMap.set(doc.filePath, {
          filePath: doc.filePath,
          content: doc.content,
          score: rrfScore,
          sources: ["vector"],
        });
      }
    }

    // Sort by combined RRF score and return top results
    return [...scoreMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults)
      .map((r) => ({
        filePath: r.filePath,
        content: r.content,
        rrfScore: r.score,
        sources: r.sources,
      }));
  }
}
