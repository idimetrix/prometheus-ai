import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:speculative");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpeculativeResult {
  content: string;
  latencyMs: number;
  model: string;
  quality: number;
  upgraded: boolean;
}

export interface SpeculativeConfig {
  /** Models to race, in order of speed (fastest first) */
  models: Array<{ key: string; slot: string; timeoutMs: number }>;
  /** Minimum quality to accept the fast model */
  qualityThreshold: number;
  /** Whether to upgrade in-place when a better result arrives */
  upgradeInPlace: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SpeculativeConfig = {
  models: [
    { key: "cerebras/qwen3-235b", slot: "fastLoop", timeoutMs: 3000 },
    { key: "ollama/qwen3-coder-next", slot: "default", timeoutMs: 8000 },
    { key: "anthropic/claude-sonnet-4-6", slot: "review", timeoutMs: 15_000 },
  ],
  qualityThreshold: 0.5,
  upgradeInPlace: true,
};

/** Hedging and refusal patterns that reduce quality scores */
const HEDGING_PATTERNS =
  /\b(I'm not sure|I don't know|I cannot|unclear|might be|possibly)\b/i;
const REFUSAL_PATTERNS =
  /\b(I can't help|I'm unable|beyond my capabilities)\b/i;

// ─── Speculative Executor ─────────────────────────────────────────────────────

export class SpeculativeExecutor {
  private readonly config: SpeculativeConfig;
  private readonly completionFn: (
    model: string,
    messages: Array<{ role: string; content: string }>
  ) => Promise<{ content: string; tokens: number }>;

  constructor(
    completionFn: (
      model: string,
      messages: Array<{ role: string; content: string }>
    ) => Promise<{ content: string; tokens: number }>,
    config?: Partial<SpeculativeConfig>
  ) {
    this.completionFn = completionFn;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Race multiple models in parallel. Returns the fastest result that
   * meets the quality threshold. If `upgradeInPlace` is enabled, continues
   * waiting for slower models and calls `onUpgrade` when a better result
   * arrives.
   *
   * Flow:
   * 1. Launch all models in parallel with per-model timeouts via AbortController
   * 2. Return the first result that meets the quality threshold
   * 3. Continue waiting for remaining models in background
   * 4. Call onUpgrade callback when a higher-quality result arrives
   */
  execute(
    messages: Array<{ role: string; content: string }>,
    onFastResult?: (result: SpeculativeResult) => void,
    onUpgrade?: (result: SpeculativeResult) => void
  ): Promise<SpeculativeResult> {
    const startTime = Date.now();
    const modelConfigs = this.config.models;

    if (modelConfigs.length === 0) {
      throw new Error("No models configured for speculative execution");
    }

    logger.info(
      {
        modelCount: modelConfigs.length,
        models: modelConfigs.map((m) => m.key),
        qualityThreshold: this.config.qualityThreshold,
      },
      "Starting speculative execution"
    );

    // Create per-model completion promises with timeout
    const raceEntries = modelConfigs.map((modelConfig) => {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => {
        controller.abort();
      }, modelConfig.timeoutMs);

      const promise = this.runWithTimeout(
        modelConfig.key,
        messages,
        controller.signal,
        startTime
      ).finally(() => {
        clearTimeout(timeoutHandle);
      });

      return { modelConfig, promise, controller };
    });

    // Use a manual resolution pattern: resolve the outer promise as soon
    // as we have an acceptable result, then continue in background.
    let accepted: SpeculativeResult | null = null;

    return new Promise<SpeculativeResult>((resolve, reject) => {
      let resolved = false;
      let completedCount = 0;
      const totalModels = raceEntries.length;

      const handleResult = (result: SpeculativeResult): void => {
        completedCount++;

        if (!resolved) {
          // First acceptable result
          if (result.quality >= this.config.qualityThreshold) {
            resolved = true;
            accepted = result;

            logger.info(
              {
                model: result.model,
                quality: result.quality.toFixed(3),
                latencyMs: result.latencyMs,
              },
              "Accepted speculative result"
            );

            onFastResult?.(result);
            resolve(result);
          } else if (completedCount === totalModels) {
            // All models completed but none met threshold — return best
            resolved = true;
            accepted = result;

            logger.warn(
              {
                model: result.model,
                quality: result.quality.toFixed(3),
              },
              "No model met quality threshold, returning best available"
            );

            resolve(result);
          }
        } else if (
          this.config.upgradeInPlace &&
          accepted &&
          result.quality > accepted.quality
        ) {
          const upgradeResult: SpeculativeResult = {
            ...result,
            upgraded: true,
          };

          logger.info(
            {
              previousModel: accepted.model,
              previousQuality: accepted.quality.toFixed(3),
              upgradeModel: result.model,
              upgradeQuality: result.quality.toFixed(3),
              upgradeLatencyMs: result.latencyMs,
            },
            "Upgrade available from slower model"
          );

          accepted = upgradeResult;
          onUpgrade?.(upgradeResult);
        }
      };

      const handleError = (model: string, error: unknown): void => {
        completedCount++;
        const msg = error instanceof Error ? error.message : String(error);
        const isAbort = error instanceof Error && error.name === "AbortError";

        if (isAbort) {
          logger.debug({ model }, "Model timed out");
        } else {
          logger.warn(
            { model, error: msg },
            "Model failed during speculative execution"
          );
        }

        // If all models failed/timed out, reject
        if (completedCount === totalModels && !resolved) {
          reject(
            new Error(
              `All ${totalModels} speculative models failed or timed out`
            )
          );
        }
      };

      // Launch all in parallel
      for (const entry of raceEntries) {
        entry.promise.then(handleResult).catch((err: unknown) => {
          handleError(entry.modelConfig.key, err);
        });
      }
    });
  }

  // ─── Private Methods ──────────────────────────────────────────────────────

  /**
   * Run a single model completion with abort signal support.
   * Returns a SpeculativeResult with quality assessment.
   */
  private async runWithTimeout(
    model: string,
    messages: Array<{ role: string; content: string }>,
    signal: AbortSignal,
    startTime: number
  ): Promise<SpeculativeResult> {
    // Check if already aborted
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    // Wrap completion to respect abort signal
    const result = await Promise.race([
      this.completionFn(model, messages),
      new Promise<never>((_resolve, rejectInner) => {
        signal.addEventListener(
          "abort",
          () => {
            rejectInner(new DOMException("Aborted", "AbortError"));
          },
          { once: true }
        );
      }),
    ]);

    const latencyMs = Date.now() - startTime;
    const quality = this.assessQuality(result.content);

    logger.debug(
      {
        model,
        latencyMs,
        tokens: result.tokens,
        quality: quality.toFixed(3),
        contentLength: result.content.length,
      },
      "Speculative model completed"
    );

    return {
      content: result.content,
      model,
      latencyMs,
      quality,
      upgraded: false,
    };
  }

  /**
   * Simple quality assessment based on content heuristics.
   *
   * Scoring signals:
   * - Content length (longer = more thorough)
   * - Presence of code blocks (indicates actionable output)
   * - Absence of hedging language
   * - Absence of refusal patterns
   * - Structural formatting (headings, lists)
   */
  private assessQuality(content: string): number {
    if (!content || content.length === 0) {
      return 0;
    }

    let score = 0;

    // Length scoring (0-0.3)
    if (content.length > 50) {
      score += 0.1;
    }
    if (content.length > 200) {
      score += 0.1;
    }
    if (content.length > 500) {
      score += 0.1;
    }

    // Code block presence (0-0.25)
    const codeBlockCount = (content.match(/```/g) ?? []).length / 2;
    if (codeBlockCount >= 1) {
      score += 0.15;
    }
    if (codeBlockCount >= 2) {
      score += 0.1;
    }

    // Structural formatting (0-0.15)
    if (content.includes("##") || content.includes("- ")) {
      score += 0.1;
    }
    if (content.includes("1.") || content.includes("*")) {
      score += 0.05;
    }

    // Confidence (0-0.3, start high and penalize)
    let confidence = 0.3;
    if (HEDGING_PATTERNS.test(content)) {
      confidence -= 0.15;
    }
    if (REFUSAL_PATTERNS.test(content)) {
      confidence -= 0.25;
    }
    score += Math.max(0, confidence);

    return Math.max(0, Math.min(1, score));
  }
}
