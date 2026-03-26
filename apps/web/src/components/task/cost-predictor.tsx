"use client";

import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Complexity = "simple" | "medium" | "complex" | "critical";
type Confidence = "low" | "medium" | "high";

interface CostEstimate {
  complexity: Complexity;
  confidence: Confidence;
  creditsHigh: number;
  creditsLow: number;
  durationMinutes: { low: number; high: number };
  historicalAverage: number | null;
  inputTokens: number;
  modelTier: string;
  outputTokens: number;
}

interface CostPredictorProps {
  description: string;
  mode: "task" | "plan" | "ask" | "watch" | "fleet";
  onBudgetSet?: (limit: number) => void;
  projectId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPLEXITY_COLORS: Record<Complexity, { bg: string; text: string }> = {
  simple: { bg: "bg-green-500/10", text: "text-green-400" },
  medium: { bg: "bg-yellow-500/10", text: "text-yellow-400" },
  complex: { bg: "bg-orange-500/10", text: "text-orange-400" },
  critical: { bg: "bg-red-500/10", text: "text-red-400" },
};

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

const MODEL_TIERS: Record<string, { label: string; costPerToken: number }> = {
  premium: { label: "Premium (Claude Opus)", costPerToken: 0.000_03 },
  standard: { label: "Standard (Claude Sonnet)", costPerToken: 0.000_01 },
  budget: { label: "Budget (Claude Haiku)", costPerToken: 0.000_003 },
};

const COMPLEXITY_PATTERNS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /refactor|rewrite|migrate/i, weight: 3 },
  { pattern: /test.*coverage|e2e|end-to-end/i, weight: 2 },
  { pattern: /security|performance|optimize/i, weight: 2 },
  { pattern: /database.*schema|api.*endpoint/i, weight: 2 },
  { pattern: /multiple files|across.*project/i, weight: 2 },
  { pattern: /entire|whole|all|complete/i, weight: 1 },
  { pattern: /simple|fix|typo|rename/i, weight: -2 },
  { pattern: /update|change|modify/i, weight: 0 },
];

const WHITESPACE_RE = /\s+/;

// ---------------------------------------------------------------------------
// Estimation Logic
// ---------------------------------------------------------------------------

function analyzeComplexity(description: string): Complexity {
  let score = 0;
  const wordCount = description.split(WHITESPACE_RE).length;

  // Word count contributes to complexity
  if (wordCount > 200) {
    score += 3;
  } else if (wordCount > 100) {
    score += 2;
  } else if (wordCount > 50) {
    score += 1;
  }

  // Pattern matching
  for (const { pattern, weight } of COMPLEXITY_PATTERNS) {
    if (pattern.test(description)) {
      score += weight;
    }
  }

  if (score >= 6) {
    return "critical";
  }
  if (score >= 4) {
    return "complex";
  }
  if (score >= 2) {
    return "medium";
  }
  return "simple";
}

function estimateTokens(
  description: string,
  complexity: Complexity
): { input: number; output: number } {
  const wordCount = description.split(WHITESPACE_RE).length;
  const baseInputTokens = Math.round(wordCount * 1.5);

  const multipliers: Record<Complexity, { input: number; output: number }> = {
    simple: { input: 500, output: 2000 },
    medium: { input: 1500, output: 8000 },
    complex: { input: 5000, output: 25_000 },
    critical: { input: 10_000, output: 50_000 },
  };

  const m = multipliers[complexity];
  return {
    input: baseInputTokens + m.input,
    output: m.output,
  };
}

function selectModelTier(complexity: Complexity): string {
  if (complexity === "critical" || complexity === "complex") {
    return "premium";
  }
  if (complexity === "medium") {
    return "standard";
  }
  return "budget";
}

function estimateDuration(complexity: Complexity): {
  low: number;
  high: number;
} {
  const durations: Record<Complexity, { low: number; high: number }> = {
    simple: { low: 1, high: 3 },
    medium: { low: 3, high: 8 },
    complex: { low: 8, high: 20 },
    critical: { low: 15, high: 45 },
  };
  return durations[complexity];
}

function computeEstimate(description: string): CostEstimate {
  const complexity = analyzeComplexity(description);
  const tokens = estimateTokens(description, complexity);
  const modelTier = selectModelTier(complexity);
  const duration = estimateDuration(complexity);
  const tierInfo = MODEL_TIERS[modelTier];

  const tokenCost =
    (tokens.input + tokens.output) * (tierInfo?.costPerToken ?? 0.000_01);
  const sandboxCost = ((duration.low + duration.high) / 2) * 0.002;
  const totalUsd = tokenCost + sandboxCost;

  // Convert USD to credits (1 credit ~ $0.01)
  const creditsLow = Math.max(1, Math.round(totalUsd * 50));
  const creditsHigh = Math.max(2, Math.round(totalUsd * 150));

  function getConfidence(len: number): Confidence {
    if (len > 200) {
      return "high";
    }
    if (len > 50) {
      return "medium";
    }
    return "low";
  }
  const confidence: Confidence = getConfidence(description.length);

  return {
    creditsLow,
    creditsHigh,
    complexity,
    confidence,
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    modelTier,
    durationMinutes: duration,
    historicalAverage: null,
  };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CreditRange({ low, high }: { low: number; high: number }) {
  return (
    <div className="flex items-center gap-2">
      <svg
        aria-hidden="true"
        className="h-5 w-5 text-yellow-500"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path d="M10.75 10.818a2.608 2.608 0 0 1-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 0 1-1.279-.2 2.349 2.349 0 0 1-.96-.609 2.372 2.372 0 0 1-.535-.858A3.2 3.2 0 0 1 4.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 0 1 1.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766ZM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
      </svg>
      <span className="font-semibold text-lg text-zinc-100">
        {low}-{high} credits
      </span>
    </div>
  );
}

function ComplexityBadge({ complexity }: { complexity: Complexity }) {
  const colors = COMPLEXITY_COLORS[complexity];
  return (
    <span
      className={`rounded-full px-2.5 py-1 font-medium text-xs capitalize ${colors.bg} ${colors.text}`}
    >
      {complexity}
    </span>
  );
}

function EstimateDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="font-mono text-xs text-zinc-300">{value}</span>
    </div>
  );
}

function BudgetLimitInput({
  onSet,
  currentLimit,
}: {
  onSet: (limit: number) => void;
  currentLimit: number | null;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(currentLimit?.toString() ?? "");

  const handleSave = useCallback(() => {
    const num = Number.parseInt(value, 10);
    if (num > 0) {
      onSet(num);
      setIsEditing(false);
    }
  }, [value, onSet]);

  if (!isEditing) {
    return (
      <button
        className="flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[10px] text-zinc-300 transition-colors hover:bg-zinc-700"
        onClick={() => setIsEditing(true)}
        type="button"
      >
        {currentLimit ? `Budget: ${currentLimit} credits` : "Set Budget Limit"}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-200 focus:border-violet-600 focus:outline-none"
        onChange={(e) => setValue(e.target.value)}
        placeholder="Credits"
        type="number"
        value={value}
      />
      <button
        className="rounded bg-violet-600 px-2 py-1 text-[10px] text-white hover:bg-violet-500"
        onClick={handleSave}
        type="button"
      >
        Set
      </button>
      <button
        className="rounded px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300"
        onClick={() => setIsEditing(false)}
        type="button"
      >
        Cancel
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function CostPredictor({
  description,
  mode: _mode,
  projectId: _projectId,
  onBudgetSet,
}: CostPredictorProps) {
  const [budgetLimit, setBudgetLimit] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const estimate = useMemo(() => computeEstimate(description), [description]);

  const tierInfo = MODEL_TIERS[estimate.modelTier];

  const handleBudgetSet = useCallback(
    (limit: number) => {
      setBudgetLimit(limit);
      onBudgetSet?.(limit);
    },
    [onBudgetSet]
  );

  if (!description.trim()) {
    return null;
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <CreditRange high={estimate.creditsHigh} low={estimate.creditsLow} />
        <div className="flex items-center gap-2">
          <ComplexityBadge complexity={estimate.complexity} />
          <span className="text-[10px] text-zinc-500">
            {CONFIDENCE_LABELS[estimate.confidence]}
          </span>
        </div>
      </div>

      {/* Summary line */}
      <div className="mt-2 flex items-center gap-4 text-xs text-zinc-500">
        <span>
          ~{estimate.durationMinutes.low}-{estimate.durationMinutes.high} min
        </span>
        <span>{tierInfo?.label ?? estimate.modelTier}</span>
        {estimate.historicalAverage !== null && (
          <span>
            Avg: {estimate.historicalAverage} credits for similar tasks
          </span>
        )}
      </div>

      {/* Budget limit */}
      <div className="mt-3 flex items-center justify-between">
        <BudgetLimitInput currentLimit={budgetLimit} onSet={handleBudgetSet} />
        <button
          className="text-[10px] text-zinc-500 hover:text-zinc-300"
          onClick={() => setShowDetails(!showDetails)}
          type="button"
        >
          {showDetails ? "Hide details" : "Show details"}
        </button>
      </div>

      {/* Budget warning */}
      {budgetLimit !== null && estimate.creditsHigh > budgetLimit && (
        <div className="mt-2 rounded border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-amber-400 text-xs">
          Estimated cost may exceed your budget of {budgetLimit} credits. The
          task will pause if the budget is reached.
        </div>
      )}

      {/* Detailed breakdown */}
      {showDetails && (
        <div className="mt-3 border-zinc-800 border-t pt-3">
          <EstimateDetail
            label="Input tokens"
            value={estimate.inputTokens.toLocaleString()}
          />
          <EstimateDetail
            label="Output tokens"
            value={estimate.outputTokens.toLocaleString()}
          />
          <EstimateDetail
            label="Model tier"
            value={tierInfo?.label ?? estimate.modelTier}
          />
          <EstimateDetail
            label="Duration"
            value={`${estimate.durationMinutes.low}-${estimate.durationMinutes.high} min`}
          />
          <EstimateDetail label="Complexity" value={estimate.complexity} />
          <EstimateDetail label="Confidence" value={estimate.confidence} />
        </div>
      )}
    </div>
  );
}
