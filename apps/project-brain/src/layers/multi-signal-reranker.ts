/**
 * Multi-Signal Reranker — extends the base reranker concept with 5 independent
 * scoring signals combined via configurable weights.
 *
 * Signals:
 *   1. Semantic Similarity (0.35) — raw cosine similarity from embedding search
 *   2. Graph Proximity    (0.20) — inverse of hop-distance in the knowledge graph
 *   3. Recency            (0.15) — how recently the file was modified
 *   4. Usage Frequency    (0.15) — how often the file appears in prior contexts
 *   5. File-Type Affinity (0.15) — how well the file extension matches the query intent
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:multi-signal-reranker");

// ─── Public Interfaces ──────────────────────────────────────────────────

export interface RerankerConfig {
  boostPaths?: string[];
  excludePaths?: string[];
  weights: {
    semanticSimilarity: number;
    graphProximity: number;
    recency: number;
    usageFrequency: number;
    fileTypeAffinity: number;
  };
}

export interface RerankCandidate {
  content?: string;
  filePath: string;
  graphDistance?: number;
  lastModified?: Date;
  similarity: number;
  usageCount?: number;
}

export interface RerankResult {
  filePath: string;
  finalScore: number;
  signals: {
    semanticSimilarity: number;
    graphProximity: number;
    recency: number;
    usageFrequency: number;
    fileTypeAffinity: number;
  };
}

// ─── Constants ──────────────────────────────────────────────────────────

const DEFAULT_WEIGHTS: RerankerConfig["weights"] = {
  semanticSimilarity: 0.35,
  graphProximity: 0.2,
  recency: 0.15,
  usageFrequency: 0.15,
  fileTypeAffinity: 0.15,
};

const DAY_MS = 86_400_000;

const WHITESPACE_RE = /\s+/;

/** File extension scoring tiers by query intent keywords. */
const INTENT_FILE_TYPES: Record<string, Record<string, number>> = {
  test: {
    test: 1.0,
    spec: 1.0,
    ts: 0.5,
    tsx: 0.5,
    js: 0.4,
    jsx: 0.4,
  },
  component: {
    tsx: 1.0,
    jsx: 0.9,
    css: 0.6,
    scss: 0.6,
    ts: 0.4,
  },
  style: {
    css: 1.0,
    scss: 1.0,
    less: 0.9,
    module: 0.8,
    tsx: 0.4,
  },
  schema: {
    ts: 0.9,
    sql: 1.0,
    prisma: 1.0,
    json: 0.5,
  },
  config: {
    json: 1.0,
    yaml: 1.0,
    yml: 1.0,
    toml: 1.0,
    ts: 0.5,
    js: 0.5,
    env: 0.8,
  },
  api: {
    ts: 0.9,
    js: 0.7,
    json: 0.4,
  },
  hook: {
    ts: 0.9,
    tsx: 0.8,
    js: 0.6,
  },
  type: {
    ts: 1.0,
    d: 0.9,
  },
};

/** Default file-type scores when no intent is detected. */
const DEFAULT_TYPE_SCORES: Record<string, number> = {
  ts: 0.9,
  tsx: 0.85,
  js: 0.7,
  jsx: 0.7,
  json: 0.4,
  yaml: 0.4,
  yml: 0.4,
  md: 0.25,
  css: 0.5,
  scss: 0.5,
  sql: 0.6,
  sh: 0.3,
  env: 0.2,
};

// ─── MultiSignalReranker ────────────────────────────────────────────────

export class MultiSignalReranker {
  private readonly config: RerankerConfig;

  constructor(config?: Partial<RerankerConfig>) {
    this.config = {
      weights: { ...DEFAULT_WEIGHTS, ...config?.weights },
      boostPaths: config?.boostPaths,
      excludePaths: config?.excludePaths,
    };

    // Validate that weights sum to ~1.0
    const weightSum = Object.values(this.config.weights).reduce(
      (sum, w) => sum + w,
      0
    );
    if (Math.abs(weightSum - 1.0) > 0.01) {
      logger.warn(
        { weightSum, weights: this.config.weights },
        "Reranker weights do not sum to 1.0, results may be skewed"
      );
    }
  }

  /**
   * Rerank a list of candidates using all 5 signals.
   * Returns results sorted by final weighted score, descending.
   */
  rerank(candidates: RerankCandidate[], query: string): RerankResult[] {
    if (candidates.length === 0) {
      return [];
    }

    // Exclude filtered paths
    const filtered = this.config.excludePaths
      ? candidates.filter(
          (c) => !this.config.excludePaths?.some((p) => c.filePath.includes(p))
        )
      : candidates;

    if (filtered.length === 0) {
      return [];
    }

    // Compute normalization bounds for usage frequency
    const maxUsage = Math.max(1, ...filtered.map((c) => c.usageCount ?? 0));

    // Detect query intent for file-type affinity
    const intent = detectQueryIntent(query);

    // Score each candidate
    const results: RerankResult[] = filtered.map((candidate) => {
      const signals = {
        semanticSimilarity: this.computeSemanticSimilarity(candidate),
        graphProximity: this.computeGraphProximity(candidate),
        recency: this.computeRecency(candidate),
        usageFrequency: this.computeUsageFrequency(candidate, maxUsage),
        fileTypeAffinity: this.computeFileTypeAffinity(
          candidate,
          query,
          intent
        ),
      };

      // Apply path boost
      let boost = 0;
      if (this.config.boostPaths) {
        for (const boostPath of this.config.boostPaths) {
          if (candidate.filePath.includes(boostPath)) {
            boost = 0.05;
            break;
          }
        }
      }

      // Penalize test files when query doesn't mention testing
      const pathLower = candidate.filePath.toLowerCase();
      let penalty = 0;
      if (
        !query.toLowerCase().includes("test") &&
        (pathLower.includes("__tests__") ||
          pathLower.includes(".test.") ||
          pathLower.includes(".spec."))
      ) {
        penalty = 0.05;
      }

      const finalScore =
        signals.semanticSimilarity * this.config.weights.semanticSimilarity +
        signals.graphProximity * this.config.weights.graphProximity +
        signals.recency * this.config.weights.recency +
        signals.usageFrequency * this.config.weights.usageFrequency +
        signals.fileTypeAffinity * this.config.weights.fileTypeAffinity +
        boost -
        penalty;

      return {
        filePath: candidate.filePath,
        finalScore: Math.max(0, Math.min(1, finalScore)),
        signals,
      };
    });

    // Sort descending by final score
    results.sort((a, b) => b.finalScore - a.finalScore);

    logger.debug(
      {
        candidateCount: candidates.length,
        filteredCount: filtered.length,
        topResult: results[0]?.filePath,
        topScore: results[0]?.finalScore,
        intent,
      },
      "Reranking complete"
    );

    return results;
  }

  // ─── Signal Computations ────────────────────────────────────────

  /**
   * Signal 1: Semantic similarity.
   * Uses the raw similarity score from embedding search, clamped to [0, 1].
   */
  private computeSemanticSimilarity(candidate: RerankCandidate): number {
    return Math.max(0, Math.min(1, candidate.similarity));
  }

  /**
   * Signal 2: Graph proximity.
   * Converts hop distance to a proximity score.
   * Distance 0 (same node) = 1.0, distance 1 = 0.8, distance 2 = 0.5,
   * distance 3 = 0.3, distance 4+ = 0.1, unknown = 0.3 (neutral).
   */
  private computeGraphProximity(candidate: RerankCandidate): number {
    const distance = candidate.graphDistance;

    if (distance === undefined || distance === null) {
      return 0.3; // Neutral when graph data is unavailable
    }

    if (distance <= 0) {
      return 1.0;
    }
    if (distance === 1) {
      return 0.8;
    }
    if (distance === 2) {
      return 0.5;
    }
    if (distance === 3) {
      return 0.3;
    }
    return 0.1;
  }

  /**
   * Signal 3: Recency.
   * Scores based on how recently the file was modified relative to now.
   */
  private computeRecency(candidate: RerankCandidate): number {
    if (!candidate.lastModified) {
      return 0.3; // Neutral when modification time is unknown
    }

    const age = Date.now() - candidate.lastModified.getTime();

    if (age < 0) {
      return 1.0; // Future dates (clock skew) treated as very recent
    }
    if (age < DAY_MS) {
      return 1.0; // Modified today
    }
    if (age < 3 * DAY_MS) {
      return 0.9; // Last 3 days
    }
    if (age < 7 * DAY_MS) {
      return 0.75; // This week
    }
    if (age < 30 * DAY_MS) {
      return 0.5; // This month
    }
    if (age < 90 * DAY_MS) {
      return 0.3; // This quarter
    }
    return 0.15; // Older
  }

  /**
   * Signal 4: Usage frequency.
   * Normalizes usage count relative to the max usage in the candidate set.
   */
  private computeUsageFrequency(
    candidate: RerankCandidate,
    maxUsage: number
  ): number {
    const count = candidate.usageCount ?? 0;
    if (maxUsage <= 0) {
      return 0.5; // Neutral if no usage data exists
    }
    // Logarithmic scaling to avoid one outlier dominating
    const logCount = Math.log1p(count);
    const logMax = Math.log1p(maxUsage);
    return logMax > 0 ? logCount / logMax : 0.5;
  }

  /**
   * Signal 5: File-type affinity.
   * Scores based on how well the file's extension matches the query intent.
   */
  private computeFileTypeAffinity(
    candidate: RerankCandidate,
    query: string,
    intent: string | null
  ): number {
    const ext = extractExtension(candidate.filePath);

    // Check for direct path-keyword match in the query
    const queryLower = query.toLowerCase();
    const fileNameLower =
      candidate.filePath.split("/").pop()?.toLowerCase() ?? "";
    const queryTerms = queryLower
      .split(WHITESPACE_RE)
      .filter((t) => t.length > 2);

    let pathBonus = 0;
    for (const term of queryTerms) {
      if (fileNameLower.includes(term)) {
        pathBonus = 0.15;
        break;
      }
    }

    // Intent-based scoring
    let typeScore: number;
    if (intent && INTENT_FILE_TYPES[intent]) {
      typeScore = INTENT_FILE_TYPES[intent][ext] ?? 0.3;
    } else {
      typeScore = DEFAULT_TYPE_SCORES[ext] ?? 0.3;
    }

    return Math.min(1, typeScore + pathBonus);
  }
}

// ─── Module-level Helpers ───────────────────────────────────────────────

/**
 * Extract the file extension (without the dot), handling multi-part
 * extensions like `.test.ts` by returning just the final segment.
 */
function extractExtension(filePath: string): string {
  const fileName = filePath.split("/").pop() ?? "";
  // Handle files like `foo.test.ts` — check if penultimate part is meaningful
  const parts = fileName.split(".");
  if (parts.length >= 3) {
    const secondLast = parts.at(-2) ?? "";
    if (secondLast === "test" || secondLast === "spec") {
      return secondLast;
    }
  }
  return (parts.pop() ?? "").toLowerCase();
}

/**
 * Detect the user's query intent to adjust file-type scoring.
 * Returns a key into INTENT_FILE_TYPES or null if no strong intent detected.
 */
function detectQueryIntent(query: string): string | null {
  const queryLower = query.toLowerCase();

  const intentKeywords: [string, string[]][] = [
    [
      "test",
      ["test", "spec", "testing", "unit test", "e2e", "integration test"],
    ],
    [
      "component",
      ["component", "ui", "button", "modal", "dialog", "widget", "page"],
    ],
    ["style", ["style", "css", "styling", "theme", "color", "layout"]],
    [
      "schema",
      [
        "schema",
        "migration",
        "table",
        "column",
        "database",
        "drizzle",
        "prisma",
      ],
    ],
    ["config", ["config", "configuration", "env", "environment", "setting"]],
    ["api", ["api", "endpoint", "route", "handler", "trpc", "rest", "graphql"]],
    ["hook", ["hook", "usehook", "use"]],
    ["type", ["type", "interface", "typing", "typedef"]],
  ];

  for (const [intent, keywords] of intentKeywords) {
    for (const keyword of keywords) {
      if (queryLower.includes(keyword)) {
        return intent;
      }
    }
  }

  return null;
}
