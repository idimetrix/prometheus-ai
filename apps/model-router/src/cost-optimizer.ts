import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:cost-optimizer");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CostProfile {
  agentRole: string;
  avgCostPerTask: number;
  avgQuality: number;
  bestModelForQuality: string;
  cheapestModelMeetingThreshold: string;
  sampleSize: number;
  taskType: string;
}

export interface BudgetConstraint {
  maxCostPerDay: number;
  maxCostPerTask: number;
  preferFreeModels: boolean;
}

export interface CostOptimizationResult {
  estimatedCost: number;
  isFreeModel: boolean;
  reasoning: string;
  recommendedModel: string;
  recommendedSlot: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Models that are completely free (local or free-tier APIs) */
const FREE_MODELS = new Set([
  "ollama/qwen2.5-coder:32b",
  "ollama/qwen2.5:14b",
  "ollama/qwen2.5-coder:14b",
  "ollama/qwen2.5-coder:7b",
  "cerebras/qwen3-235b",
  "cerebras/llama-3.3-70b",
  "groq/llama-3.3-70b-versatile",
  "groq/mixtral-8x7b-32768",
]);

/** Cost tiers for paid models ($ per 1M tokens, input+output average) */
const MODEL_COSTS: Record<string, number> = {
  "deepseek/deepseek-coder": 0.21,
  "deepseek/deepseek-r1": 3.5,
  "gemini/gemini-2.5-flash": 0.5,
  "anthropic/claude-sonnet-4-6": 9.0,
  "anthropic/claude-opus-4-6": 40.0,
  "openai/gpt-5": 5.63,
};

/** Minimum quality threshold for accepting a model */
const QUALITY_THRESHOLD = 0.6;

/** Default free model for simple tasks */
const DEFAULT_FREE_MODEL = "cerebras/qwen3-235b";

/** Default cheap paid model for complex tasks */
const DEFAULT_CHEAP_PAID_MODEL = "deepseek/deepseek-coder";

/** Slot mapping for models */
const MODEL_SLOT_MAP: Record<string, string> = {
  "cerebras/qwen3-235b": "fastLoop",
  "groq/llama-3.3-70b-versatile": "fastLoop",
  "groq/mixtral-8x7b-32768": "fastLoop",
  "ollama/qwen2.5-coder:32b": "default",
  "ollama/qwen2.5:14b": "think",
  "ollama/qwen2.5-coder:14b": "background",
  "ollama/qwen2.5-coder:7b": "background",
  "cerebras/llama-3.3-70b": "fastLoop",
  "deepseek/deepseek-coder": "default",
  "deepseek/deepseek-r1": "think",
  "gemini/gemini-2.5-flash": "default",
  "anthropic/claude-sonnet-4-6": "review",
  "anthropic/claude-opus-4-6": "premium",
  "openai/gpt-5": "review",
};

/** Task types considered "simple" that can default to free models */
const SIMPLE_TASK_TYPES = new Set([
  "format",
  "lint",
  "rename",
  "typo",
  "comment",
  "docstring",
  "boilerplate",
  "template",
]);

// ─── Internal History ─────────────────────────────────────────────────────────

interface HistoryEntry {
  cost: number;
  modelKey: string;
  quality: number;
  timestamp: number;
}

// ─── Cost Optimizer ───────────────────────────────────────────────────────────

export class CostOptimizer {
  private readonly profiles = new Map<string, CostProfile>();
  private readonly history = new Map<string, HistoryEntry[]>();
  private dailyCost = 0;
  private dailyCostResetAt = 0;
  private freeRequestCount = 0;
  private paidRequestCount = 0;

  /**
   * Record the actual cost from a completed request.
   * Updates historical profiles used for future optimization decisions.
   */
  recordCost(
    agentRole: string,
    taskType: string,
    modelKey: string,
    cost: number,
    quality: number
  ): void {
    const profileKey = `${agentRole}:${taskType}`;

    // Track daily cost
    this.ensureDailyReset();
    this.dailyCost += cost;

    if (FREE_MODELS.has(modelKey)) {
      this.freeRequestCount++;
    } else {
      this.paidRequestCount++;
    }

    // Add to history
    const entries = this.history.get(profileKey) ?? [];
    entries.push({ modelKey, cost, quality, timestamp: Date.now() });

    // Keep last 500 entries per profile
    if (entries.length > 500) {
      entries.splice(0, entries.length - 500);
    }
    this.history.set(profileKey, entries);

    // Recompute profile
    this.recomputeProfile(agentRole, taskType, entries);

    logger.debug(
      {
        agentRole,
        taskType,
        modelKey,
        cost: cost.toFixed(6),
        quality: quality.toFixed(3),
        dailyCost: this.dailyCost.toFixed(4),
      },
      "Recorded cost for optimization"
    );
  }

  /**
   * Get a cost-optimized model recommendation for the given agent role and task type.
   *
   * Decision logic:
   * 1. If daily budget is exhausted, force free models
   * 2. Look up historical cost profile for agentRole+taskType
   * 3. If no history, default to free models for simple tasks, cheapest paid for complex
   * 4. If history exists, find cheapest model that achieved >0.6 quality
   * 5. Always prefer free models when they meet quality threshold
   */
  optimize(
    agentRole: string,
    taskType: string,
    budget?: BudgetConstraint
  ): CostOptimizationResult {
    this.ensureDailyReset();

    // Step 1: Check if daily budget is exhausted
    if (!this.checkDailyBudget(budget)) {
      const model = DEFAULT_FREE_MODEL;
      const slot = MODEL_SLOT_MAP[model] ?? "default";

      logger.info(
        {
          agentRole,
          taskType,
          dailyCost: this.dailyCost.toFixed(4),
          maxDaily: budget?.maxCostPerDay,
        },
        "Daily budget exhausted, forcing free model"
      );

      return {
        recommendedModel: model,
        recommendedSlot: slot,
        estimatedCost: 0,
        reasoning:
          "Daily budget exhausted — routing to free model to avoid further spend.",
        isFreeModel: true,
      };
    }

    // Step 2: Look up historical cost profile
    const profileKey = `${agentRole}:${taskType}`;
    const _profile = this.profiles.get(profileKey);
    const entries = this.history.get(profileKey) ?? [];

    // Step 3: No history — use defaults
    if (entries.length === 0) {
      return this.defaultRecommendation(agentRole, taskType, budget);
    }

    // Step 4: Find cheapest model that achieved quality > threshold
    const modelStats = this.aggregateModelStats(entries);
    const qualifyingModels = modelStats
      .filter((m) => m.avgQuality >= QUALITY_THRESHOLD)
      .sort((a, b) => a.avgCost - b.avgCost);

    // Step 5: Try free models, then paid models, then best quality, then default
    const result =
      this.tryFreeQualifyingModel(
        qualifyingModels,
        agentRole,
        taskType,
        budget
      ) ??
      this.tryCheapestPaidModel(
        qualifyingModels,
        agentRole,
        taskType,
        budget
      ) ??
      this.tryBestQualityModel(modelStats, agentRole, taskType, budget) ??
      this.defaultRecommendation(agentRole, taskType, budget);

    return result;
  }

  private tryFreeQualifyingModel(
    qualifyingModels: Array<{
      modelKey: string;
      avgQuality: number;
      avgCost: number;
      count: number;
    }>,
    agentRole: string,
    taskType: string,
    budget?: BudgetConstraint
  ): CostOptimizationResult | null {
    const freeQualifying = qualifyingModels.filter((m) =>
      FREE_MODELS.has(m.modelKey)
    );
    if (
      freeQualifying.length === 0 ||
      (budget && budget.preferFreeModels === false)
    ) {
      return null;
    }
    const best = freeQualifying[0];
    if (!best) {
      return null;
    }
    logger.info(
      {
        agentRole,
        taskType,
        model: best.modelKey,
        avgQuality: best.avgQuality.toFixed(3),
        samples: best.count,
      },
      "Recommending free model based on historical quality"
    );
    return {
      recommendedModel: best.modelKey,
      recommendedSlot: MODEL_SLOT_MAP[best.modelKey] ?? "default",
      estimatedCost: 0,
      reasoning: `Free model "${best.modelKey}" meets quality threshold (avg ${best.avgQuality.toFixed(2)} over ${best.count} samples). Zero cost.`,
      isFreeModel: true,
    };
  }

  private tryCheapestPaidModel(
    qualifyingModels: Array<{
      modelKey: string;
      avgQuality: number;
      avgCost: number;
      count: number;
    }>,
    agentRole: string,
    taskType: string,
    budget?: BudgetConstraint
  ): CostOptimizationResult | null {
    if (qualifyingModels.length === 0) {
      return null;
    }
    const best = qualifyingModels[0];
    if (!best) {
      return null;
    }
    if (budget?.maxCostPerTask && best.avgCost > budget.maxCostPerTask) {
      return this.fallbackToFreeModel(
        agentRole,
        taskType,
        `Cheapest qualifying model "${best.modelKey}" costs $${best.avgCost.toFixed(4)}/task, exceeding per-task budget of $${budget.maxCostPerTask.toFixed(4)}. Falling back to free model.`
      );
    }
    const isFree = FREE_MODELS.has(best.modelKey);
    return {
      recommendedModel: best.modelKey,
      recommendedSlot: MODEL_SLOT_MAP[best.modelKey] ?? "default",
      estimatedCost: isFree ? 0 : best.avgCost,
      reasoning: `Cheapest model meeting quality threshold: "${best.modelKey}" (avg quality ${best.avgQuality.toFixed(2)}, avg cost $${best.avgCost.toFixed(4)} over ${best.count} samples).`,
      isFreeModel: isFree,
    };
  }

  private tryBestQualityModel(
    modelStats: Array<{
      modelKey: string;
      avgQuality: number;
      avgCost: number;
      count: number;
    }>,
    _agentRole: string,
    _taskType: string,
    _budget?: BudgetConstraint
  ): CostOptimizationResult | null {
    const sortedByQuality = modelStats.sort(
      (a, b) => b.avgQuality - a.avgQuality
    );
    if (sortedByQuality.length === 0) {
      return null;
    }
    const best = sortedByQuality[0];
    if (!best) {
      return null;
    }
    const isFree = FREE_MODELS.has(best.modelKey);
    return {
      recommendedModel: best.modelKey,
      recommendedSlot: MODEL_SLOT_MAP[best.modelKey] ?? "default",
      estimatedCost: isFree ? 0 : best.avgCost,
      reasoning: `No model met quality threshold (${QUALITY_THRESHOLD}). Using highest-quality model: "${best.modelKey}" (avg quality ${best.avgQuality.toFixed(2)}).`,
      isFreeModel: isFree,
    };
  }

  /** Get cost profiles for monitoring */
  getProfiles(): CostProfile[] {
    return [...this.profiles.values()];
  }

  /** Get daily spend breakdown */
  getDailySpend(): {
    totalUsd: number;
    freePercentage: number;
    paidPercentage: number;
  } {
    this.ensureDailyReset();
    const totalRequests = this.freeRequestCount + this.paidRequestCount;

    if (totalRequests === 0) {
      return { totalUsd: 0, freePercentage: 0, paidPercentage: 0 };
    }

    return {
      totalUsd: this.dailyCost,
      freePercentage: (this.freeRequestCount / totalRequests) * 100,
      paidPercentage: (this.paidRequestCount / totalRequests) * 100,
    };
  }

  /** Reset daily counter (called by scheduler) */
  resetDaily(): void {
    logger.info(
      {
        totalUsd: this.dailyCost.toFixed(4),
        freeRequests: this.freeRequestCount,
        paidRequests: this.paidRequestCount,
      },
      "Resetting daily cost counters"
    );
    this.dailyCost = 0;
    this.freeRequestCount = 0;
    this.paidRequestCount = 0;
    this.dailyCostResetAt = this.getTodayStart();
  }

  // ─── Private Methods ──────────────────────────────────────────────────────

  /** Check whether daily budget still allows paid requests */
  private checkDailyBudget(budget?: BudgetConstraint): boolean {
    if (!budget?.maxCostPerDay) {
      return true;
    }
    return this.dailyCost < budget.maxCostPerDay;
  }

  /** Ensure the daily counters are reset if we crossed midnight */
  private ensureDailyReset(): void {
    const todayStart = this.getTodayStart();
    if (this.dailyCostResetAt < todayStart) {
      this.resetDaily();
    }
  }

  /** Get timestamp for start of today (UTC) */
  private getTodayStart(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  /** Default recommendation when no historical data exists */
  private defaultRecommendation(
    agentRole: string,
    taskType: string,
    budget?: BudgetConstraint
  ): CostOptimizationResult {
    const isSimple = SIMPLE_TASK_TYPES.has(taskType);
    const preferFree = budget?.preferFreeModels ?? true;

    if (isSimple || preferFree) {
      const model = DEFAULT_FREE_MODEL;
      const slot = MODEL_SLOT_MAP[model] ?? "default";

      return {
        recommendedModel: model,
        recommendedSlot: slot,
        estimatedCost: 0,
        reasoning: isSimple
          ? `Simple task type "${taskType}" — defaulting to free model "${model}".`
          : `No historical data for ${agentRole}/${taskType} — defaulting to free model "${model}".`,
        isFreeModel: true,
      };
    }

    const model = DEFAULT_CHEAP_PAID_MODEL;
    const slot = MODEL_SLOT_MAP[model] ?? "default";
    const estimatedCost = (MODEL_COSTS[model] ?? 0) * 0.002; // ~2K tokens

    return {
      recommendedModel: model,
      recommendedSlot: slot,
      estimatedCost,
      reasoning: `No historical data for ${agentRole}/${taskType}, complex task — using cheapest paid model "${model}" ($${(MODEL_COSTS[model] ?? 0).toFixed(2)}/1M tokens).`,
      isFreeModel: false,
    };
  }

  /** Fallback to a free model with an explanation */
  private fallbackToFreeModel(
    _agentRole: string,
    _taskType: string,
    reasoning: string
  ): CostOptimizationResult {
    const model = DEFAULT_FREE_MODEL;
    const slot = MODEL_SLOT_MAP[model] ?? "default";

    return {
      recommendedModel: model,
      recommendedSlot: slot,
      estimatedCost: 0,
      reasoning,
      isFreeModel: true,
    };
  }

  /** Aggregate per-model statistics from history entries */
  private aggregateModelStats(entries: HistoryEntry[]): Array<{
    modelKey: string;
    avgCost: number;
    avgQuality: number;
    count: number;
  }> {
    const map = new Map<
      string,
      { totalCost: number; totalQuality: number; count: number }
    >();

    for (const entry of entries) {
      const stats = map.get(entry.modelKey) ?? {
        totalCost: 0,
        totalQuality: 0,
        count: 0,
      };
      stats.totalCost += entry.cost;
      stats.totalQuality += entry.quality;
      stats.count++;
      map.set(entry.modelKey, stats);
    }

    const results: Array<{
      modelKey: string;
      avgCost: number;
      avgQuality: number;
      count: number;
    }> = [];

    for (const [modelKey, stats] of map) {
      results.push({
        modelKey,
        avgCost: stats.totalCost / stats.count,
        avgQuality: stats.totalQuality / stats.count,
        count: stats.count,
      });
    }

    return results;
  }

  /** Recompute the cached CostProfile from history entries */
  private recomputeProfile(
    agentRole: string,
    taskType: string,
    entries: HistoryEntry[]
  ): void {
    const profileKey = `${agentRole}:${taskType}`;
    const stats = this.aggregateModelStats(entries);

    if (stats.length === 0) {
      return;
    }

    const bestForQuality = stats.reduce((best, curr) =>
      curr.avgQuality > best.avgQuality ? curr : best
    );

    const qualifying = stats
      .filter((s) => s.avgQuality >= QUALITY_THRESHOLD)
      .sort((a, b) => a.avgCost - b.avgCost);

    const cheapestMeeting = qualifying[0] ?? bestForQuality;

    const totalCost = entries.reduce((sum, e) => sum + e.cost, 0);
    const totalQuality = entries.reduce((sum, e) => sum + e.quality, 0);

    this.profiles.set(profileKey, {
      agentRole,
      taskType,
      avgCostPerTask: totalCost / entries.length,
      avgQuality: totalQuality / entries.length,
      bestModelForQuality: bestForQuality.modelKey,
      cheapestModelMeetingThreshold: cheapestMeeting.modelKey,
      sampleSize: entries.length,
    });
  }
}
