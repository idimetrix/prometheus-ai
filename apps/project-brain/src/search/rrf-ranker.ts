/**
 * Reciprocal Rank Fusion (RRF) implementation.
 * Combines results from multiple search methods into a single ranked list.
 *
 * Formula: score(doc) = Σ 1/(k + rank_in_method)
 * Where k is a constant (default 60) that controls how much weight
 * lower-ranked results receive.
 */

export interface RankedDocument {
  content: string;
  endLine?: number;
  filePath: string;
  /** Identifier for deduplication */
  id: string;
  metadata?: Record<string, unknown>;
  /** Original scores from each search method */
  methodScores: Record<string, number>;
  /** Combined RRF score */
  score: number;
  /** Search method that found this document */
  source: string;
  startLine?: number;
  symbolName?: string;
  symbolType?: string;
}

export interface RRFConfig {
  /** The k parameter in the RRF formula (default 60) */
  k: number;
  /** Maximum results to return */
  maxResults: number;
  /** Per-method weight multipliers */
  methodWeights: Record<string, number>;
}

const DEFAULT_CONFIG: RRFConfig = {
  k: 60,
  maxResults: 20,
  methodWeights: {
    semantic: 1.0,
    zoekt: 1.0,
    "ast-grep": 1.0,
  },
};

export interface SearchMethodResult {
  method: string;
  results: Array<{
    content: string;
    filePath: string;
    id: string;
    metadata?: Record<string, unknown>;
    score: number;
    startLine?: number;
    endLine?: number;
    symbolName?: string;
    symbolType?: string;
  }>;
}

export class RRFRanker {
  private readonly config: RRFConfig;

  constructor(config?: Partial<RRFConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Fuse results from multiple search methods using RRF.
   */
  fuse(methodResults: SearchMethodResult[]): RankedDocument[] {
    const docScores = new Map<string, RankedDocument>();

    for (const { method, results } of methodResults) {
      const weight = this.config.methodWeights[method] ?? 1.0;

      for (let rank = 0; rank < results.length; rank++) {
        const result = results[rank];
        if (!result) {
          continue;
        }

        const rrfScore = weight * (1 / (this.config.k + rank + 1));
        const existing = docScores.get(result.id);

        if (existing) {
          existing.score += rrfScore;
          existing.methodScores[method] = result.score;
        } else {
          docScores.set(result.id, {
            id: result.id,
            filePath: result.filePath,
            content: result.content,
            score: rrfScore,
            source: method,
            methodScores: { [method]: result.score },
            metadata: result.metadata,
            startLine: result.startLine,
            endLine: result.endLine,
            symbolName: result.symbolName,
            symbolType: result.symbolType,
          });
        }
      }
    }

    return Array.from(docScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxResults);
  }
}
