import { createLogger } from "@prometheus/logger";

const _logger = createLogger("project-brain:reranker");

const WHITESPACE_RE = /\s+/;
const EXPORT_RE = /\bexport\b/g;
const FUNCTION_RE = /\bfunction\b/g;
const CLASS_RE = /\bclass\b/g;
const INTERFACE_RE = /\binterface\b/g;
const TYPE_RE = /\btype\b/g;
const CONST_RE = /\bconst\b/g;
const ASYNC_RE = /\basync\b/g;

export interface RerankableResult {
  content: string;
  filePath: string;
  metadata?: Record<string, unknown>;
  score: number;
}

export interface RerankOptions {
  /** Paths to boost in ranking */
  boostPaths?: string[];
  /** Paths to exclude */
  excludePaths?: string[];
  /** Boost for specific file types */
  fileTypes?: string[];
  /** Boost recently modified files */
  recentlyModified?: boolean;
}

/**
 * Reranker improves semantic search results by combining multiple signals:
 * - Cosine similarity (40%)
 * - Path relevance (20%)
 * - Recency (15%)
 * - File type match (10%)
 * - Symbol density (15%)
 */
export class Reranker {
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

      const combinedScore =
        similarity + pathRelevance + recency + fileType + symbolDensity;

      return { ...result, score: combinedScore };
    });

    // Filter excluded paths
    const filtered = options.excludePaths
      ? scored.filter(
          (r) => !options.excludePaths?.some((p) => r.filePath.includes(p))
        )
      : scored;

    // Sort by combined score descending
    return filtered.sort((a, b) => b.score - a.score);
  }

  private scorePathRelevance(
    filePath: string,
    query: string,
    options: RerankOptions
  ): number {
    let score = 0;

    // Boost if path matches query keywords
    const queryWords = query.toLowerCase().split(WHITESPACE_RE);
    const pathLower = filePath.toLowerCase();
    for (const word of queryWords) {
      if (word.length > 2 && pathLower.includes(word)) {
        score += 0.3;
      }
    }

    // Boost configured paths
    if (options.boostPaths) {
      for (const boostPath of options.boostPaths) {
        if (filePath.includes(boostPath)) {
          score += 0.4;
          break;
        }
      }
    }

    // Prefer src/ over test files for non-test queries
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
      return 0.5; // neutral
    }

    const modifiedAt = result.metadata?.modifiedAt;
    if (!modifiedAt) {
      return 0.3;
    }

    const age = Date.now() - new Date(modifiedAt as string).getTime();
    const dayMs = 86_400_000;

    if (age < dayMs) {
      return 1.0; // Today
    }
    if (age < 7 * dayMs) {
      return 0.8; // This week
    }
    if (age < 30 * dayMs) {
      return 0.5; // This month
    }
    return 0.2;
  }

  private scoreFileType(filePath: string, options: RerankOptions): number {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";

    if (options.fileTypes && options.fileTypes.length > 0) {
      return options.fileTypes.includes(ext) ? 1.0 : 0.3;
    }

    // Default preference: source files > config > docs
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
    // Count meaningful code symbols: functions, classes, interfaces, exports
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
      const matches = content.match(pattern);
      count += matches?.length ?? 0;
    }

    // Normalize: expect ~5-20 symbols per meaningful code chunk
    return Math.min(1, count / 15);
  }
}
