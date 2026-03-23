"use client";

import { useMemo, useState } from "react";

export interface HealthMetrics {
  complexity: number;
  coupling: number;
  overallScore: number;
  techDebt: number;
  testCoverage: number;
}

export interface HealthTrendPoint {
  date: string;
  score: number;
}

export interface HealthIssue {
  description: string;
  filePath: string;
  id: string;
  severity: "critical" | "warning" | "info";
}

interface HealthDashboardProps {
  issues?: HealthIssue[];
  metrics: HealthMetrics;
  onIssueClick?: (issue: HealthIssue) => void;
  trend?: HealthTrendPoint[];
}

function scoreColor(score: number): string {
  if (score >= 80) {
    return "text-green-400";
  }
  if (score >= 60) {
    return "text-amber-400";
  }
  return "text-red-400";
}

function scoreBgColor(score: number): string {
  if (score >= 80) {
    return "bg-green-500";
  }
  if (score >= 60) {
    return "bg-amber-500";
  }
  return "bg-red-500";
}

function scoreRingColor(score: number): string {
  if (score >= 80) {
    return "stroke-green-500";
  }
  if (score >= 60) {
    return "stroke-amber-500";
  }
  return "stroke-red-500";
}

const SEVERITY_STYLES: Record<string, { badge: string; dot: string }> = {
  critical: {
    badge: "bg-red-500/20 text-red-400",
    dot: "bg-red-500",
  },
  warning: {
    badge: "bg-amber-500/20 text-amber-400",
    dot: "bg-amber-500",
  },
  info: {
    badge: "bg-blue-500/20 text-blue-400",
    dot: "bg-blue-500",
  },
};

function ScoreRing({ score, size = 100 }: { score: number; size?: number }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <svg aria-hidden="true" className="shrink-0" height={size} width={size}>
      <circle
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        stroke="#27272a"
        strokeWidth={6}
      />
      <circle
        className={`${scoreRingColor(score)} transition-all duration-500`}
        cx={size / 2}
        cy={size / 2}
        fill="none"
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth={6}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        className={`font-bold text-xl ${scoreColor(score)}`}
        dominantBaseline="central"
        fill="currentColor"
        textAnchor="middle"
        x={size / 2}
        y={size / 2}
      >
        {score}
      </text>
    </svg>
  );
}

function MetricCard({
  label,
  value,
  maxValue = 100,
}: {
  label: string;
  maxValue?: number;
  value: number;
}) {
  const pct = Math.round((value / maxValue) * 100);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-500">{label}</span>
        <span className={`font-bold font-mono text-sm ${scoreColor(pct)}`}>
          {value}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${scoreBgColor(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TrendChart({ data }: { data: HealthTrendPoint[] }) {
  const maxScore = useMemo(
    () => Math.max(...data.map((d) => d.score), 100),
    [data]
  );

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-zinc-600">
        No trend data available
      </div>
    );
  }

  return (
    <div className="flex h-32 items-end gap-1">
      {data.map((point) => {
        const heightPct = (point.score / maxScore) * 100;
        return (
          <div
            className="group relative flex flex-1 flex-col items-center justify-end"
            key={point.date}
          >
            {/* Tooltip */}
            <div className="pointer-events-none absolute -top-7 hidden rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300 group-hover:block">
              {point.score}
            </div>
            <div
              className={`w-full min-w-[8px] rounded-t transition-all ${scoreBgColor(point.score)} opacity-70 hover:opacity-100`}
              style={{ height: `${heightPct}%` }}
            />
            <span className="mt-1 text-[8px] text-zinc-600 leading-none">
              {point.date.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function HealthDashboard({
  metrics,
  trend = [],
  issues = [],
  onIssueClick,
}: HealthDashboardProps) {
  const [showAllIssues, setShowAllIssues] = useState(false);
  const displayedIssues = showAllIssues ? issues : issues.slice(0, 5);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      {/* Header: Overall Score + Metrics */}
      <div className="flex items-start gap-6">
        {/* Score ring */}
        <div className="flex flex-col items-center gap-1">
          <ScoreRing score={metrics.overallScore} />
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Health Score
          </span>
        </div>

        {/* Metrics grid */}
        <div className="grid flex-1 grid-cols-2 gap-2">
          <MetricCard label="Complexity" value={100 - metrics.complexity} />
          <MetricCard label="Coupling" value={100 - metrics.coupling} />
          <MetricCard label="Test Coverage" value={metrics.testCoverage} />
          <MetricCard label="Tech Debt" value={100 - metrics.techDebt} />
        </div>
      </div>

      {/* Trend Chart */}
      {trend.length > 0 && (
        <div>
          <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
            Score Trend
          </h4>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <TrendChart data={trend} />
          </div>
        </div>
      )}

      {/* Top Issues */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
            Top Issues ({issues.length})
          </h4>
          {issues.length > 5 && (
            <button
              className="text-[10px] text-violet-400 hover:text-violet-300"
              onClick={() => setShowAllIssues((prev) => !prev)}
              type="button"
            >
              {showAllIssues ? "Show less" : "Show all"}
            </button>
          )}
        </div>

        {issues.length === 0 ? (
          <p className="text-xs text-zinc-600">No issues found</p>
        ) : (
          <div className="space-y-1">
            {displayedIssues.map((issue) => {
              const styles = SEVERITY_STYLES[issue.severity] ??
                SEVERITY_STYLES.info ?? {
                  dot: "bg-zinc-500",
                  badge: "bg-zinc-500/20 text-zinc-400",
                };
              return (
                <button
                  className="flex w-full items-start gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-2.5 py-2 text-left transition-colors hover:bg-zinc-900"
                  key={issue.id}
                  onClick={() => onIssueClick?.(issue)}
                  type="button"
                >
                  <span
                    className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-300">{issue.description}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">
                      {issue.filePath}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[9px] ${styles.badge}`}
                  >
                    {issue.severity}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
