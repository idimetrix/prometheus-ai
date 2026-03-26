"use client";

/**
 * Codebase Health Dashboard
 *
 * Comprehensive health metrics including test coverage, build success rate,
 * PR merge time, tech debt, security vulnerabilities, dependency freshness,
 * trend charts, and actionable improvement items.
 */

import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TimeRange = "7d" | "30d" | "90d";

type TrendDirection = "up" | "down" | "stable";

interface HealthMetric {
  changePercent: number;
  description: string;
  label: string;
  suffix?: string;
  trend: TrendDirection;
  trendData: number[];
  value: number;
}

interface ModuleHealth {
  issues: number;
  name: string;
  score: number;
}

interface ActionItem {
  description: string;
  effort: string;
  impact: "high" | "medium" | "low";
  module: string;
}

interface IndustryBenchmark {
  industry: number;
  label: string;
  yours: number;
}

interface CodebaseHealthProps {
  /** Action items for improving health */
  actionItems?: ActionItem[];
  /** Industry benchmark comparisons */
  benchmarks?: IndustryBenchmark[];
  className?: string;
  /** Metrics to display */
  metrics?: HealthMetric[];
  /** Per-module health breakdown */
  modules?: ModuleHealth[];
  /** Overall health score 0-100 */
  overallScore?: number;
  /** Overall trend */
  overallTrend?: TrendDirection;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIME_RANGES: TimeRange[] = ["7d", "30d", "90d"];

const TREND_ICON: Record<TrendDirection, string> = {
  up: "\u2191",
  down: "\u2193",
  stable: "\u2192",
};

const TREND_COLOR: Record<TrendDirection, string> = {
  up: "text-green-400",
  down: "text-red-400",
  stable: "text-zinc-400",
};

const IMPACT_COLOR: Record<ActionItem["impact"], string> = {
  high: "bg-red-500/20 text-red-400",
  medium: "bg-yellow-500/20 text-yellow-400",
  low: "bg-blue-500/20 text-blue-400",
};

const SCORE_THRESHOLDS = {
  good: 80,
  warning: 60,
} as const;

// ---------------------------------------------------------------------------
// Default data
// ---------------------------------------------------------------------------

const DEFAULT_METRICS: HealthMetric[] = [
  {
    label: "Test Coverage",
    value: 78,
    suffix: "%",
    trend: "up",
    changePercent: 3.2,
    description: "Percentage of code covered by tests",
    trendData: [72, 73, 74, 75, 76, 77, 78],
  },
  {
    label: "Build Success Rate",
    value: 94,
    suffix: "%",
    trend: "stable",
    changePercent: 0.5,
    description: "Successful builds in the last 30 days",
    trendData: [92, 93, 94, 93, 95, 94, 94],
  },
  {
    label: "Avg PR Merge Time",
    value: 4.2,
    suffix: "hrs",
    trend: "down",
    changePercent: -12,
    description: "Average time from PR open to merge",
    trendData: [6.1, 5.8, 5.2, 4.9, 4.5, 4.3, 4.2],
  },
  {
    label: "Open Issues",
    value: 23,
    trend: "down",
    changePercent: -8,
    description: "Total open issues by severity",
    trendData: [31, 29, 27, 26, 25, 24, 23],
  },
  {
    label: "Tech Debt Score",
    value: 34,
    suffix: "/100",
    trend: "down",
    changePercent: -5,
    description: "Lower is better - from tech debt analysis",
    trendData: [42, 40, 38, 37, 36, 35, 34],
  },
  {
    label: "Security Vulns",
    value: 2,
    trend: "down",
    changePercent: -60,
    description: "Known security vulnerabilities",
    trendData: [7, 5, 5, 4, 3, 3, 2],
  },
  {
    label: "Dependency Freshness",
    value: 87,
    suffix: "%",
    trend: "up",
    changePercent: 4,
    description: "Percentage of dependencies on latest version",
    trendData: [80, 82, 83, 84, 85, 86, 87],
  },
];

const DEFAULT_MODULES: ModuleHealth[] = [
  { name: "apps/web", score: 82, issues: 5 },
  { name: "apps/api", score: 88, issues: 3 },
  { name: "apps/orchestrator", score: 75, issues: 8 },
  { name: "packages/db", score: 91, issues: 1 },
  { name: "packages/ui", score: 85, issues: 4 },
  { name: "packages/auth", score: 79, issues: 6 },
];

const DEFAULT_ACTION_ITEMS: ActionItem[] = [
  {
    impact: "high",
    module: "apps/orchestrator",
    description: "Reduce cyclomatic complexity in agent-loop.ts (currently 45)",
    effort: "2-3 days",
  },
  {
    impact: "high",
    module: "packages/auth",
    description: "Add integration tests for token refresh flow",
    effort: "1 day",
  },
  {
    impact: "medium",
    module: "apps/web",
    description: "Replace 12 instances of 'any' type with proper types",
    effort: "4 hours",
  },
  {
    impact: "medium",
    module: "apps/api",
    description: "Update 3 stale dependencies with known vulnerabilities",
    effort: "2 hours",
  },
  {
    impact: "low",
    module: "packages/ui",
    description: "Add missing accessibility labels to 8 components",
    effort: "3 hours",
  },
];

const DEFAULT_BENCHMARKS: IndustryBenchmark[] = [
  { label: "Test Coverage", yours: 78, industry: 70 },
  { label: "Build Success", yours: 94, industry: 90 },
  { label: "PR Merge Time (hrs)", yours: 4.2, industry: 8 },
  { label: "Dependency Freshness", yours: 87, industry: 75 },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreRing({ score, trend }: { score: number; trend: TrendDirection }) {
  const circumference = 2 * Math.PI * 45;
  const progress = (score / 100) * circumference;
  let color = "#ef4444";
  if (score >= SCORE_THRESHOLDS.good) {
    color = "#22c55e";
  } else if (score >= SCORE_THRESHOLDS.warning) {
    color = "#eab308";
  }

  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      <svg
        aria-label={`Health score: ${score} out of 100`}
        className="-rotate-90"
        height="128"
        role="img"
        width="128"
      >
        <circle
          cx="64"
          cy="64"
          fill="none"
          r="45"
          stroke="#27272a"
          strokeWidth="8"
        />
        <circle
          cx="64"
          cy="64"
          fill="none"
          r="45"
          stroke={color}
          strokeDasharray={`${progress} ${circumference}`}
          strokeLinecap="round"
          strokeWidth="8"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-bold text-2xl text-zinc-100">{score}</span>
        <span className={`text-xs ${TREND_COLOR[trend]}`}>
          {TREND_ICON[trend]} {trend}
        </span>
      </div>
    </div>
  );
}

function MiniSparkline({
  data,
  color = "currentColor",
}: {
  color?: string;
  data: number[];
}) {
  if (data.length < 2) {
    return null;
  }

  const width = 80;
  const height = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg aria-hidden="true" className="shrink-0" height={height} width={width}>
      <polyline
        fill="none"
        points={points}
        stroke={color}
        strokeLinecap="round"
        strokeWidth={1.5}
      />
    </svg>
  );
}

function MetricCard({ metric }: { metric: HealthMetric }) {
  const trendIsPositive =
    metric.label === "Avg PR Merge Time" ||
    metric.label === "Tech Debt Score" ||
    metric.label === "Security Vulns" ||
    metric.label === "Open Issues"
      ? metric.changePercent < 0
      : metric.changePercent > 0;

  const trendColor = trendIsPositive ? "text-green-400" : "text-red-400";

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500">{metric.label}</span>
        <MiniSparkline
          color={trendIsPositive ? "#22c55e" : "#ef4444"}
          data={metric.trendData}
        />
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="font-bold text-2xl text-zinc-100">
          {metric.value}
          {metric.suffix && (
            <span className="text-sm text-zinc-500">{metric.suffix}</span>
          )}
        </span>
        <span className={`mb-0.5 text-xs ${trendColor}`}>
          {metric.changePercent > 0 ? "+" : ""}
          {metric.changePercent}%
        </span>
      </div>
      <div className="mt-1 text-[10px] text-zinc-600">{metric.description}</div>
    </div>
  );
}

function ModuleBreakdown({ modules }: { modules: ModuleHealth[] }) {
  const sorted = useMemo(
    () => [...modules].sort((a, b) => a.score - b.score),
    [modules]
  );

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
      <h3 className="mb-3 font-semibold text-sm text-zinc-200">
        Module Health
      </h3>
      <div className="flex flex-col gap-2">
        {sorted.map((mod) => {
          let barColor = "bg-red-500";
          if (mod.score >= SCORE_THRESHOLDS.good) {
            barColor = "bg-green-500";
          } else if (mod.score >= SCORE_THRESHOLDS.warning) {
            barColor = "bg-yellow-500";
          }

          return (
            <div key={mod.name}>
              <div className="flex items-center justify-between">
                <code className="text-[11px] text-zinc-400">{mod.name}</code>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-zinc-500">
                    {mod.issues} issues
                  </span>
                  <span className="font-medium text-xs text-zinc-200">
                    {mod.score}
                  </span>
                </div>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full ${barColor} transition-all`}
                  style={{ width: `${mod.score}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionItems({ items }: { items: ActionItem[] }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
      <h3 className="mb-3 font-semibold text-sm text-zinc-200">
        Top Actions to Improve Health
      </h3>
      <div className="flex flex-col gap-2">
        {items.slice(0, 5).map((item) => (
          <div
            className="flex items-start gap-3 rounded-md border border-zinc-800 bg-zinc-900/30 p-3"
            key={`${item.module}-${item.description}`}
          >
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${IMPACT_COLOR[item.impact]}`}
            >
              {item.impact}
            </span>
            <div className="flex-1">
              <div className="text-xs text-zinc-300">{item.description}</div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
                <span>{item.module}</span>
                <span>|</span>
                <span>{item.effort}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BenchmarkComparison({
  benchmarks,
}: {
  benchmarks: IndustryBenchmark[];
}) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
      <h3 className="mb-3 font-semibold text-sm text-zinc-200">
        Industry Benchmarks
      </h3>
      <div className="flex flex-col gap-3">
        {benchmarks.map((bench) => {
          const isAhead =
            bench.label === "PR Merge Time (hrs)"
              ? bench.yours < bench.industry
              : bench.yours > bench.industry;

          return (
            <div key={bench.label}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-zinc-400">{bench.label}</span>
                <span
                  className={`text-[11px] ${isAhead ? "text-green-400" : "text-red-400"}`}
                >
                  {isAhead ? "Above" : "Below"} average
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={`h-full rounded-full ${isAhead ? "bg-green-500" : "bg-red-500"}`}
                    style={{
                      width: `${Math.min(100, (bench.yours / Math.max(bench.yours, bench.industry)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-[10px] text-zinc-500">
                  {bench.yours} vs {bench.industry}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function CodebaseHealthDashboard({
  overallScore = 81,
  overallTrend = "up",
  metrics = DEFAULT_METRICS,
  modules = DEFAULT_MODULES,
  actionItems = DEFAULT_ACTION_ITEMS,
  benchmarks = DEFAULT_BENCHMARKS,
  className = "",
}: CodebaseHealthProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Header with overall score and time range */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <ScoreRing score={overallScore} trend={overallTrend} />
          <div>
            <h2 className="font-bold text-lg text-zinc-100">Codebase Health</h2>
            <p className="text-sm text-zinc-500">
              Overall score based on {metrics.length} metrics across{" "}
              {modules.length} modules
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-md bg-zinc-800 p-0.5">
          {TIME_RANGES.map((range) => (
            <button
              aria-label={`Show ${range} data`}
              className={`rounded px-3 py-1 text-xs transition-colors ${
                timeRange === range
                  ? "bg-zinc-700 text-zinc-200"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              key={range}
              onClick={() => setTimeRange(range)}
              type="button"
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      {/* Bottom section: modules, actions, benchmarks */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ModuleBreakdown modules={modules} />
        <ActionItems items={actionItems} />
        <BenchmarkComparison benchmarks={benchmarks} />
      </div>
    </div>
  );
}

export type {
  ActionItem,
  CodebaseHealthProps,
  HealthMetric,
  IndustryBenchmark,
  ModuleHealth,
  TimeRange,
  TrendDirection,
};
