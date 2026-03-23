/**
 * Query Classifier for Hybrid Search
 *
 * Classifies incoming search queries to dynamically weight the three
 * search methods (semantic, zoekt, ast-grep) based on query characteristics.
 *
 * - exact: literal identifiers, paths, imports → boost zoekt
 * - conceptual: natural language questions → boost semantic
 * - structural: code pattern queries → boost ast-grep
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:query-classifier");

export type QueryType = "exact" | "conceptual" | "structural";

export interface QueryClassification {
  type: QueryType;
  weights: {
    semantic: number;
    zoekt: number;
    astGrep: number;
  };
}

/** Patterns that indicate an exact/literal search */
const EXACT_INDICATORS = [
  // Quoted strings
  /^["'].*["']$/,
  // Import paths like @prometheus/logger or ./foo/bar
  /^[@./][\w/.@-]+$/,
  // Function-style identifiers: camelCase, snake_case, PascalCase
  /^[a-zA-Z_]\w*$/,
  // Dot-separated identifiers like foo.bar.baz
  /^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)+$/,
  // File path patterns
  /\.\w{1,5}$/,
  // Package-scoped names like @scope/pkg
  /^@[\w-]+\/[\w-]+/,
];

/** Patterns that indicate a structural/AST query */
const STRUCTURAL_INDICATORS = [
  // ast-grep style $VAR placeholders
  /\$[A-Z_]+/,
  // Type annotations like `: Promise<void>`, `: string`
  /:\s*(Promise|Array|Map|Set|Record|string|number|boolean)\b/,
  // Function declarations/arrows
  /\b(function|const|let|var)\s+\$?\w*\s*[=(]/,
  // Generic type parameters
  /<[A-Z]\w*(,\s*[A-Z]\w*)*>/,
  // Pattern-like syntax (ellipsis, wildcards)
  /\.\.\./,
  // Interface/type/class declarations
  /\b(interface|type|class)\s+/,
  // Arrow function patterns
  /=>\s*\{/,
  // Explicit "pattern:" prefix
  /^pattern:/i,
];

/** Patterns that indicate a conceptual/natural language query */
const CONCEPTUAL_INDICATORS = [
  // Question words
  /^(how|what|where|why|when|which|who|can|does|is|are|should)\b/i,
  // Natural language phrases
  /\b(implement|explain|describe|find all|show me|look for)\b/i,
  // Multi-word queries with spaces (more than 3 words suggests NL)
  /^\w+(\s+\w+){3,}/,
  // Queries about concepts
  /\b(authentication|authorization|routing|middleware|handler|logic|flow|process)\b/i,
  // "how does X work" style
  /\bhow\s+does\b/i,
  // Queries with prepositions suggesting NL
  /\b(with|from|into|about|using|between)\b/i,
];

function scoreIndicators(query: string, patterns: RegExp[]): number {
  let score = 0;
  for (const pattern of patterns) {
    if (pattern.test(query)) {
      score += 1;
    }
  }
  return score;
}

/**
 * Classify a search query to determine optimal search method weights.
 *
 * Returns the detected query type and per-method weight multipliers
 * that can be applied to the RRF ranker.
 */
export function classifyQuery(query: string): QueryClassification {
  const trimmed = query.trim();

  if (trimmed.length === 0) {
    return {
      type: "conceptual",
      weights: { semantic: 1.0, zoekt: 0.5, astGrep: 0.3 },
    };
  }

  const exactScore = scoreIndicators(trimmed, EXACT_INDICATORS);
  const structuralScore = scoreIndicators(trimmed, STRUCTURAL_INDICATORS);
  const conceptualScore = scoreIndicators(trimmed, CONCEPTUAL_INDICATORS);

  logger.debug(
    {
      query: trimmed.slice(0, 80),
      exactScore,
      structuralScore,
      conceptualScore,
    },
    "Query classification scores"
  );

  // Structural wins when AST-pattern syntax is detected
  if (structuralScore > exactScore && structuralScore > conceptualScore) {
    return {
      type: "structural",
      weights: { semantic: 0.4, zoekt: 0.6, astGrep: 1.5 },
    };
  }

  // Exact wins for identifier-like or path-like queries
  if (exactScore > conceptualScore) {
    return {
      type: "exact",
      weights: { semantic: 0.5, zoekt: 1.5, astGrep: 0.6 },
    };
  }

  // Default: conceptual/natural language
  return {
    type: "conceptual",
    weights: { semantic: 1.5, zoekt: 0.6, astGrep: 0.4 },
  };
}

/**
 * QueryClassifier class for stateful usage with configurable thresholds.
 */
export class QueryClassifier {
  private readonly baseWeights: QueryClassification["weights"];

  constructor(
    baseWeights: QueryClassification["weights"] = {
      semantic: 1.0,
      zoekt: 0.9,
      astGrep: 0.85,
    }
  ) {
    this.baseWeights = baseWeights;
  }

  /**
   * Classify a query and return adjusted weights that multiply
   * against the base weights provided at construction.
   */
  classify(query: string): QueryClassification {
    const classification = classifyQuery(query);

    return {
      type: classification.type,
      weights: {
        semantic: this.baseWeights.semantic * classification.weights.semantic,
        zoekt: this.baseWeights.zoekt * classification.weights.zoekt,
        astGrep: this.baseWeights.astGrep * classification.weights.astGrep,
      },
    };
  }
}
