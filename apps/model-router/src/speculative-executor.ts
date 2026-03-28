/**
 * GAP-097: Speculative Execution Engine
 *
 * Runs a fast draft model first. If confidence is high, returns immediately.
 * If low confidence, verifies with a premium model. Tracks latency savings.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:speculative-executor");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpeculativeExecResult {
  confidence: number;
  content: string;
  latencyMs: number;
  model: string;
  usedFastPath: boolean;
  verifiedByPremium: boolean;
}

export interface SpeculativeExecConfig {
  /** Confidence threshold to accept draft (0-1, default: 0.7) */
  confidenceThreshold: number;
  /** Fast draft model key */
  draftModel: string;
  /** Timeout for draft model in ms (default: 5s) */
  draftTimeoutMs: number;
  /** Premium verification model key */
  premiumModel: string;
  /** Timeout for premium model in ms (default: 30s) */
  premiumTimeoutMs: number;
}

export interface SpeculativeExecStats {
  avgDraftLatencyMs: number;
  avgPremiumLatencyMs: number;
  draftFailures: number;
  fastPathAccepted: number;
  latencySavedMs: number;
  premiumVerifications: number;
  totalRequests: number;
}

type CompletionFn = (
  model: string,
  messages: Array<{ role: string; content: string }>
) => Promise<{ content: string; tokens: number }>;

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SpeculativeExecConfig = {
  draftModel: "cerebras/qwen3-235b",
  premiumModel: "anthropic/claude-sonnet-4-6",
  confidenceThreshold: 0.7,
  draftTimeoutMs: 5000,
  premiumTimeoutMs: 30_000,
};

/** Patterns indicating low-confidence output */
const LOW_CONFIDENCE_PATTERNS =
  /\b(I'm not sure|I don't know|unclear|might be|possibly|I cannot|I can't)\b/i;

const CODE_BLOCK_RE = /```/g;

// ─── Speculative Executor ─────────────────────────────────────────────────────

export class SpeculativeExecutorEngine {
  private readonly config: SpeculativeExecConfig;
  private readonly completionFn: CompletionFn;
  private readonly stats: SpeculativeExecStats = {
    totalRequests: 0,
    fastPathAccepted: 0,
    premiumVerifications: 0,
    draftFailures: 0,
    avgDraftLatencyMs: 0,
    avgPremiumLatencyMs: 0,
    latencySavedMs: 0,
  };

  constructor(
    completionFn: CompletionFn,
    config?: Partial<SpeculativeExecConfig>
  ) {
    this.completionFn = completionFn;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute with speculative draft-then-verify pattern.
   */
  async execute(
    messages: Array<{ role: string; content: string }>
  ): Promise<SpeculativeExecResult> {
    this.stats.totalRequests++;
    const overallStart = Date.now();

    // Step 1: Run draft model with timeout
    try {
      const draftStart = Date.now();
      const draftResult = await this.runWithTimeout(
        this.config.draftModel,
        messages,
        this.config.draftTimeoutMs
      );
      const draftLatency = Date.now() - draftStart;
      this.updateAvg("draft", draftLatency);

      // Assess confidence of draft output
      const confidence = this.assessConfidence(draftResult.content);

      logger.debug(
        {
          model: this.config.draftModel,
          confidence: confidence.toFixed(3),
          latencyMs: draftLatency,
        },
        "Draft model completed"
      );

      if (confidence >= this.config.confidenceThreshold) {
        // Fast path: accept draft
        this.stats.fastPathAccepted++;
        this.stats.latencySavedMs +=
          this.stats.avgPremiumLatencyMs - draftLatency;

        return {
          content: draftResult.content,
          model: this.config.draftModel,
          latencyMs: Date.now() - overallStart,
          confidence,
          usedFastPath: true,
          verifiedByPremium: false,
        };
      }

      // Step 2: Low confidence - verify with premium model
      logger.info(
        { confidence: confidence.toFixed(3) },
        "Draft confidence below threshold, escalating to premium"
      );
      return await this.verifyWithPremium(messages, overallStart);
    } catch (error) {
      // Draft failed - fall through to premium
      this.stats.draftFailures++;
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { error: msg },
        "Draft model failed, falling back to premium"
      );
      return await this.verifyWithPremium(messages, overallStart);
    }
  }

  /**
   * Get execution statistics.
   */
  getStats(): SpeculativeExecStats {
    return { ...this.stats };
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private async verifyWithPremium(
    messages: Array<{ role: string; content: string }>,
    overallStart: number
  ): Promise<SpeculativeExecResult> {
    this.stats.premiumVerifications++;

    const premiumStart = Date.now();
    const result = await this.runWithTimeout(
      this.config.premiumModel,
      messages,
      this.config.premiumTimeoutMs
    );
    const premiumLatency = Date.now() - premiumStart;
    this.updateAvg("premium", premiumLatency);

    return {
      content: result.content,
      model: this.config.premiumModel,
      latencyMs: Date.now() - overallStart,
      confidence: this.assessConfidence(result.content),
      usedFastPath: false,
      verifiedByPremium: true,
    };
  }

  private async runWithTimeout(
    model: string,
    messages: Array<{ role: string; content: string }>,
    timeoutMs: number
  ): Promise<{ content: string; tokens: number }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await Promise.race([
        this.completionFn(model, messages),
        new Promise<never>((_resolve, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
            { once: true }
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  private assessConfidence(content: string): number {
    if (!content || content.length === 0) {
      return 0;
    }

    let score = 0.5;

    // Longer responses tend to be more thorough
    if (content.length > 200) {
      score += 0.1;
    }
    if (content.length > 500) {
      score += 0.1;
    }

    // Code blocks indicate actionable output
    const codeBlocks = (content.match(CODE_BLOCK_RE) ?? []).length / 2;
    if (codeBlocks >= 1) {
      score += 0.15;
    }

    // Penalize hedging language
    if (LOW_CONFIDENCE_PATTERNS.test(content)) {
      score -= 0.2;
    }

    return Math.max(0, Math.min(1, score));
  }

  private updateAvg(type: "draft" | "premium", latencyMs: number): void {
    if (type === "draft") {
      const n = this.stats.fastPathAccepted + this.stats.draftFailures;
      this.stats.avgDraftLatencyMs =
        (this.stats.avgDraftLatencyMs * Math.max(0, n - 1) + latencyMs) /
        Math.max(1, n);
    } else {
      const n = this.stats.premiumVerifications;
      this.stats.avgPremiumLatencyMs =
        (this.stats.avgPremiumLatencyMs * Math.max(0, n - 1) + latencyMs) /
        Math.max(1, n);
    }
  }
}
