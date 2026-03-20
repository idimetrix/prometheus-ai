/**
 * Shared search types used across BM25, vector, graph, and fusion search.
 */

/**
 * Base search result shared across all search strategies.
 */
export interface BaseSearchResult {
  /** The matching content snippet */
  content: string;
  /** End line of the match (optional) */
  endLine?: number;
  /** File path relative to project root */
  filePath: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  /** Relevance score (higher is better) */
  score: number;
  /** Start line of the match (optional) */
  startLine?: number;
}

/**
 * Search result with source attribution.
 */
export interface AttributedSearchResult extends BaseSearchResult {
  /** Unique identifier for deduplication */
  id: string;
  /** Which search method(s) produced this result */
  sources: string[];
}

/**
 * Available search strategies.
 */
export type SearchStrategy = "bm25" | "vector" | "graph" | "zoekt" | "ast-grep";

/**
 * Options for configuring a search query.
 */
export interface SearchOptions {
  /** Maximum results per individual strategy */
  maxPerStrategy?: number;
  /** Whether to apply cross-encoder reranking */
  rerank?: boolean;
  /** Which strategies to use (default: all available) */
  strategies?: SearchStrategy[];
  /** Maximum total results after fusion */
  topK?: number;
}

/**
 * Response from a search operation.
 */
export interface SearchResponse {
  /** Total time in milliseconds */
  latencyMs: number;
  /** Per-strategy latencies */
  methodLatencies: Record<string, number>;
  /** Fused and ranked results */
  results: AttributedSearchResult[];
  /** Total candidates before fusion */
  totalCandidates: number;
}

/**
 * Statistics for a search operation.
 */
export interface SearchStats {
  /** Number of candidates from each strategy */
  candidatesPerStrategy: Record<string, number>;
  /** Total search duration in ms */
  durationMs: number;
  /** Number of strategies that succeeded */
  strategiesUsed: number;
}
