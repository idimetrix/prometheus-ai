/**
 * Phase 2.5: Task Complexity Estimator
 *
 * Analyzes incoming requests to estimate task complexity on a 1-5 scale.
 * Uses heuristic signals (token count, file references, multi-step detection,
 * domain keywords, historical patterns) to recommend the optimal model slot.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:complexity-estimator");

/** Keywords that signal higher-complexity domain tasks */
const DOMAIN_KEYWORDS: Record<string, number> = {
  // Architecture & design (weight: high)
  architecture: 3,
  "system design": 3,
  microservice: 3,
  distributed: 3,
  scalability: 3,

  // Security (weight: high)
  security: 3,
  authentication: 2,
  authorization: 2,
  encryption: 3,
  vulnerability: 3,
  csrf: 2,
  xss: 2,
  injection: 2,

  // Database (weight: medium-high)
  database: 2,
  schema: 2,
  migration: 2,
  transaction: 2,
  "race condition": 3,
  deadlock: 3,
  index: 1,

  // Performance (weight: medium)
  optimization: 2,
  performance: 2,
  caching: 2,
  "memory leak": 3,
  profiling: 2,

  // Complex patterns (weight: high)
  refactor: 2,
  "state machine": 3,
  "event sourcing": 3,
  cqrs: 3,
  saga: 3,
  websocket: 2,
  streaming: 2,
  concurrent: 3,
  parallel: 2,

  // Testing (weight: medium)
  "integration test": 2,
  "e2e test": 2,
  "load test": 2,
  "property test": 2,

  // Infrastructure (weight: medium-high)
  kubernetes: 2,
  docker: 1,
  terraform: 2,
  "ci/cd": 2,
  deployment: 2,
};

/** Patterns that indicate multi-step tasks */
const MULTI_STEP_PATTERNS = [
  /\b(?:first|then|after that|next|finally|step \d+)\b/i,
  /\b(?:and also|additionally|moreover|furthermore)\b/i,
  /\d+\.\s+/,
  /[-*]\s+.+\n[-*]\s+/,
  /\b(?:create|implement|write|build)\b.*\b(?:and|then)\b.*\b(?:create|implement|write|build|test|deploy)\b/i,
  /\b(?:multiple|several|various|all)\s+(?:files|components|services|endpoints|tests)\b/i,
];

/** File extension complexity weights */
const FILE_TYPE_WEIGHTS: Record<string, number> = {
  ".ts": 1.0,
  ".tsx": 1.2,
  ".sql": 1.5,
  ".yaml": 0.8,
  ".yml": 0.8,
  ".json": 0.5,
  ".md": 0.3,
  ".css": 0.6,
  ".scss": 0.7,
  ".dockerfile": 1.0,
  ".tf": 1.5,
};

/** Slot recommendations by complexity score — aligned with router SLOT_CONFIGS */
const SLOT_MAP: Record<number, string> = {
  1: "fastLoop",
  2: "default",
  3: "default",
  4: "think",
  5: "premium",
};

export interface ComplexitySignals {
  fileCount: number;
  hasDomainKeywords: boolean;
  historicalDifficulty: number;
  isMultiStep: boolean;
  tokenCount: number;
}

export interface ComplexityEstimate {
  reasoning: string;
  recommendedSlot: string;
  score: number;
  signals: ComplexitySignals;
}

/**
 * Rough token count estimation.
 * Uses the heuristic of ~4 characters per token for English text / code.
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Count file references in the message content.
 */
const FILE_EXT_PATTERN = /\b[\w./-]+\.\w{1,5}\b/g; // file.ext patterns
const BACKTICK_FILE_PATTERN = /`[^`]+\.\w{1,5}`/g; // backtick-quoted files
const FILE_EXT_EXTRACT = /\.(\w+)$/;
const BACKTICK_CLEAN = /`/g;

function countFileReferences(text: string): number {
  const filePatterns = [FILE_EXT_PATTERN, BACKTICK_FILE_PATTERN];

  const files = new Set<string>();
  for (const pattern of filePatterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        const cleaned = match.replace(BACKTICK_CLEAN, "");
        // Filter to likely file paths
        const ext = cleaned.match(FILE_EXT_EXTRACT)?.[1] ?? "";
        if (ext && FILE_TYPE_WEIGHTS[`.${ext}`] !== undefined) {
          files.add(cleaned);
        }
      }
    }
  }

  return files.size;
}

/**
 * Detect multi-step task patterns in the text.
 */
function detectMultiStep(text: string): boolean {
  for (const pattern of MULTI_STEP_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }

  // Also check for numbered lists with 3+ items
  const numberedItems = text.match(/^\d+\.\s+/gm);
  if (numberedItems && numberedItems.length >= 3) {
    return true;
  }

  return false;
}

/**
 * Calculate domain keyword weight from the text.
 */
function calculateDomainWeight(text: string): {
  found: boolean;
  weight: number;
} {
  const lowerText = text.toLowerCase();
  let totalWeight = 0;
  let matchCount = 0;

  for (const [keyword, weight] of Object.entries(DOMAIN_KEYWORDS)) {
    if (lowerText.includes(keyword)) {
      totalWeight += weight;
      matchCount++;
    }
  }

  return {
    found: matchCount > 0,
    weight: totalWeight,
  };
}

export class ComplexityEstimator {
  /** Historical difficulty tracking (in-memory, keyed by task type) */
  private readonly history = new Map<string, number[]>();

  /**
   * Estimate complexity of a request and recommend a model slot.
   */
  estimate(request: {
    messages: Array<{ role: string; content: string }>;
    taskType?: string;
  }): ComplexityEstimate {
    const fullText = request.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");

    const tokenCount = estimateTokenCount(fullText);
    const fileCount = countFileReferences(fullText);
    const isMultiStep = detectMultiStep(fullText);
    const domain = calculateDomainWeight(fullText);
    const historicalDifficulty = this.getHistoricalDifficulty(
      request.taskType ?? "general"
    );

    // Compute sub-scores (each 0-1)
    const tokenScore = Math.min(tokenCount / 4000, 1.0);
    const fileScore = Math.min(fileCount / 10, 1.0);
    const multiStepScore = isMultiStep ? 0.7 : 0.0;
    const domainScore = Math.min(domain.weight / 10, 1.0);
    const historyScore = historicalDifficulty;

    // Weighted composite score (0-1)
    const composite =
      tokenScore * 0.15 +
      fileScore * 0.2 +
      multiStepScore * 0.25 +
      domainScore * 0.25 +
      historyScore * 0.15;

    // Map 0-1 to 1-5 scale
    const score = Math.max(1, Math.min(5, Math.ceil(composite * 5)));
    const recommendedSlot = SLOT_MAP[score] ?? "balanced";

    const signals: ComplexitySignals = {
      tokenCount,
      fileCount,
      isMultiStep,
      hasDomainKeywords: domain.found,
      historicalDifficulty,
    };

    const reasoning = this.buildReasoning(score, signals, domain.weight);

    logger.info(
      {
        score,
        slot: recommendedSlot,
        tokenCount,
        fileCount,
        isMultiStep,
        domainWeight: domain.weight,
      },
      "Complexity estimation complete"
    );

    return { score, reasoning, recommendedSlot, signals };
  }

  /**
   * Record the actual difficulty of a completed task for future calibration.
   */
  recordOutcome(taskType: string, actualDifficulty: number): void {
    const existing = this.history.get(taskType) ?? [];
    existing.push(Math.max(0, Math.min(1, actualDifficulty)));

    // Keep a sliding window of 50 entries
    if (existing.length > 50) {
      existing.shift();
    }

    this.history.set(taskType, existing);
  }

  private getHistoricalDifficulty(taskType: string): number {
    const entries = this.history.get(taskType);
    if (!entries || entries.length === 0) {
      return 0.5; // Default: medium
    }

    const sum = entries.reduce((a, b) => a + b, 0);
    return sum / entries.length;
  }

  private buildReasoning(
    score: number,
    signals: ComplexitySignals,
    domainWeight: number
  ): string {
    const parts: string[] = [];

    parts.push(`Complexity score: ${score}/5.`);

    if (signals.tokenCount > 2000) {
      parts.push(
        `Large input (~${signals.tokenCount} tokens) suggests detailed requirements.`
      );
    }

    if (signals.fileCount > 5) {
      parts.push(
        `References ${signals.fileCount} files, indicating cross-cutting changes.`
      );
    } else if (signals.fileCount > 0) {
      parts.push(`References ${signals.fileCount} file(s).`);
    }

    if (signals.isMultiStep) {
      parts.push(
        "Task contains multi-step instructions requiring sequential execution."
      );
    }

    if (signals.hasDomainKeywords) {
      parts.push(
        `Domain-specific keywords detected (weight: ${domainWeight}), requiring specialized knowledge.`
      );
    }

    if (signals.historicalDifficulty > 0.7) {
      parts.push(
        "Historical data indicates this task type is typically difficult."
      );
    } else if (signals.historicalDifficulty < 0.3) {
      parts.push(
        "Historical data indicates this task type is typically straightforward."
      );
    }

    return parts.join(" ");
  }
}
