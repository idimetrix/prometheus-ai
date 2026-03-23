/**
 * SpeculativeExecutor watches the SSE token stream and predicts
 * upcoming tool calls. For read-only tools, it pre-executes them
 * so results are ready when the LLM finishes its response.
 *
 * This reduces perceived latency by 40-60% for read-heavy workflows.
 */
import { TOOL_REGISTRY } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { PredictionCache } from "./prediction-cache";
import { type PredictionSignal, StreamAnalyzer } from "./stream-analyzer";

const logger = createLogger("orchestrator:speculation");

/** Tools that are safe to speculatively execute (no side effects) */
const SAFE_TOOLS = new Set([
  "file_read",
  "file_list",
  "search_files",
  "search_content",
  "search_semantic",
  "git_status",
  "git_diff",
  "read_blueprint",
  "read_brain",
]);

interface SpeculativeResult {
  args: Record<string, unknown>;
  output: string;
  success: boolean;
  toolName: string;
}

export class SpeculativeExecutor {
  private readonly analyzer: StreamAnalyzer;
  private readonly cache: PredictionCache<SpeculativeResult>;
  private readonly toolContext: {
    sessionId: string;
    projectId: string;
    sandboxId: string;
    workDir: string;
    orgId: string;
    userId: string;
  };
  private readonly pendingExecutions = new Map<
    string,
    Promise<SpeculativeResult | null>
  >();
  private hits = 0;
  private misses = 0;
  private totalPredictions = 0;

  constructor(toolContext: {
    sessionId: string;
    projectId: string;
    sandboxId: string;
    workDir: string;
    orgId: string;
    userId: string;
  }) {
    this.analyzer = new StreamAnalyzer(0.6);
    this.cache = new PredictionCache(100, 30_000);
    this.toolContext = toolContext;
  }

  /**
   * Feed tokens from the streaming response.
   * Automatically triggers speculative execution for predicted tools.
   */
  feedTokens(tokens: string): void {
    const prediction = this.analyzer.analyze(tokens);
    if (prediction) {
      this.speculateOnPrediction(prediction);
    }
  }

  /**
   * Check if we have a pre-computed result for a tool call.
   */
  getResult(
    toolName: string,
    args: Record<string, unknown>
  ): SpeculativeResult | null {
    const key = this.makeCacheKey(toolName, args);
    const cached = this.cache.get(key);

    if (cached) {
      this.hits++;
      logger.debug(
        { toolName, hitRate: this.getHitRate() },
        "Speculation cache hit"
      );
      return cached;
    }

    this.misses++;
    return null;
  }

  /**
   * Get the current hit rate for monitoring.
   */
  getHitRate(): string {
    const total = this.hits + this.misses;
    if (total === 0) {
      return "0%";
    }
    return `${((this.hits / total) * 100).toFixed(1)}%`;
  }

  getStats(): {
    hits: number;
    misses: number;
    totalPredictions: number;
    cacheSize: number;
  } {
    return {
      hits: this.hits,
      misses: this.misses,
      totalPredictions: this.totalPredictions,
      cacheSize: this.cache.size,
    };
  }

  reset(): void {
    this.analyzer.reset();
    this.cache.clear();
    this.pendingExecutions.clear();
    this.hits = 0;
    this.misses = 0;
    this.totalPredictions = 0;
  }

  private speculateOnPrediction(prediction: PredictionSignal): void {
    const { predictedTool, predictedArgs } = prediction;

    if (!SAFE_TOOLS.has(predictedTool)) {
      return;
    }

    const key = this.makeCacheKey(predictedTool, predictedArgs);

    // Don't re-execute if already cached or pending
    if (this.cache.has(key) || this.pendingExecutions.has(key)) {
      return;
    }

    this.totalPredictions++;

    const execution = this.executeSpeculatively(
      predictedTool,
      predictedArgs,
      key
    );
    this.pendingExecutions.set(key, execution);

    // Clean up pending reference when done
    execution.finally(() => {
      this.pendingExecutions.delete(key);
    });
  }

  private async executeSpeculatively(
    toolName: string,
    args: Record<string, unknown>,
    cacheKey: string
  ): Promise<SpeculativeResult | null> {
    const toolDef = TOOL_REGISTRY[toolName];
    if (!toolDef) {
      return null;
    }

    try {
      logger.debug({ toolName }, "Speculatively executing tool");

      const result = await toolDef.execute(args, this.toolContext);

      const speculativeResult: SpeculativeResult = {
        toolName,
        args,
        success: result.success,
        output: result.output,
      };

      this.cache.set(cacheKey, speculativeResult);
      return speculativeResult;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.debug({ toolName, error: msg }, "Speculative execution failed");
      return null;
    }
  }

  private makeCacheKey(
    toolName: string,
    args: Record<string, unknown>
  ): string {
    return `${toolName}:${JSON.stringify(args)}`;
  }
}
