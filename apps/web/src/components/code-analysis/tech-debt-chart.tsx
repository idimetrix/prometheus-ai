"use client";

import { useMemo, useState } from "react";

export type DebtCategory =
  | "architecture"
  | "code-quality"
  | "testing"
  | "documentation"
  | "security"
  | "performance";

export interface DebtDataPoint {
  date: string;
  values: Record<DebtCategory, number>;
}

export interface DebtPriorityItem {
  category: DebtCategory;
  description: string;
  effort: "low" | "medium" | "high";
  filePath: string;
  id: string;
  score: number;
}

interface TechDebtChartProps {
  data: DebtDataPoint[];
  onItemClick?: (item: DebtPriorityItem) => void;
  priorityItems?: DebtPriorityItem[];
  totalScore?: number;
}

const CATEGORY_COLORS: Record<
  DebtCategory,
  { bar: string; text: string; bg: string }
> = {
  architecture: {
    bar: "bg-violet-500",
    text: "text-violet-400",
    bg: "bg-violet-500/20",
  },
  "code-quality": {
    bar: "bg-blue-500",
    text: "text-blue-400",
    bg: "bg-blue-500/20",
  },
  testing: {
    bar: "bg-green-500",
    text: "text-green-400",
    bg: "bg-green-500/20",
  },
  documentation: {
    bar: "bg-amber-500",
    text: "text-amber-400",
    bg: "bg-amber-500/20",
  },
  security: { bar: "bg-red-500", text: "text-red-400", bg: "bg-red-500/20" },
  performance: {
    bar: "bg-cyan-500",
    text: "text-cyan-400",
    bg: "bg-cyan-500/20",
  },
};

const ALL_CATEGORIES: DebtCategory[] = [
  "architecture",
  "code-quality",
  "testing",
  "documentation",
  "security",
  "performance",
];

function debtScoreColor(score: number): string {
  if (score >= 70) {
    return "text-red-400";
  }
  if (score >= 40) {
    return "text-amber-400";
  }
  return "text-green-400";
}

const EFFORT_STYLES: Record<string, string> = {
  low: "bg-green-500/20 text-green-400",
  medium: "bg-amber-500/20 text-amber-400",
  high: "bg-red-500/20 text-red-400",
};

function StackedBar({
  values,
  maxValue,
  date,
}: {
  date: string;
  maxValue: number;
  values: Record<DebtCategory, number>;
}) {
  const total = Object.values(values).reduce((sum, v) => sum + v, 0);
  const heightPct = maxValue > 0 ? (total / maxValue) * 100 : 0;

  return (
    <div className="group relative flex flex-1 flex-col items-center justify-end">
      {/* Tooltip */}
      <div className="pointer-events-none absolute -top-9 z-10 hidden min-w-[80px] rounded bg-zinc-800 px-2 py-1 text-center text-[10px] text-zinc-300 shadow-lg group-hover:block">
        <div className="font-medium">{total} pts</div>
        <div className="text-zinc-500">{date}</div>
      </div>
      <div
        className="flex w-full min-w-[12px] flex-col overflow-hidden rounded-t transition-all"
        style={{ height: `${heightPct}%` }}
      >
        {ALL_CATEGORIES.map((cat) => {
          const val = values[cat] ?? 0;
          if (val === 0) {
            return null;
          }
          const segPct = total > 0 ? (val / total) * 100 : 0;
          const colors = CATEGORY_COLORS[cat];
          return (
            <div
              className={`${colors.bar} opacity-70 transition-opacity group-hover:opacity-100`}
              key={cat}
              style={{ height: `${segPct}%` }}
            />
          );
        })}
      </div>
      <span className="mt-1 text-[8px] text-zinc-600 leading-none">
        {date.slice(5)}
      </span>
    </div>
  );
}

export function TechDebtChart({
  data,
  totalScore,
  priorityItems = [],
  onItemClick,
}: TechDebtChartProps) {
  const [showAllItems, setShowAllItems] = useState(false);

  const maxValue = useMemo(() => {
    let max = 0;
    for (const point of data) {
      const total = Object.values(point.values).reduce((sum, v) => sum + v, 0);
      if (total > max) {
        max = total;
      }
    }
    return max || 100;
  }, [data]);

  const displayedItems = showAllItems
    ? priorityItems
    : priorityItems.slice(0, 5);

  // Current breakdown from last data point
  const currentBreakdown = useMemo(() => {
    if (data.length === 0) {
      return null;
    }
    return data.at(-1)?.values ?? null;
  }, [data]);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm text-zinc-200">Tech Debt</h3>
        {totalScore !== undefined && (
          <span
            className={`font-bold font-mono text-lg ${debtScoreColor(totalScore)}`}
          >
            {totalScore}
          </span>
        )}
      </div>

      {/* Current Breakdown */}
      {currentBreakdown && (
        <div className="grid grid-cols-3 gap-1.5">
          {ALL_CATEGORIES.map((cat) => {
            const val = currentBreakdown[cat] ?? 0;
            const colors = CATEGORY_COLORS[cat];
            return (
              <div
                className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1"
                key={cat}
              >
                <span
                  className={`inline-block h-2 w-2 rounded-sm ${colors.bar}`}
                />
                <span className="flex-1 truncate text-[10px] text-zinc-400">
                  {cat.replace("-", " ")}
                </span>
                <span
                  className={`font-bold font-mono text-[10px] ${colors.text}`}
                >
                  {val}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Stacked Bar Chart */}
      {data.length > 0 && (
        <div>
          <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
            Debt Over Time
          </h4>
          <div className="flex h-36 items-end gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            {data.map((point) => (
              <StackedBar
                date={point.date}
                key={point.date}
                maxValue={maxValue}
                values={point.values}
              />
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {ALL_CATEGORIES.map((cat) => {
          const colors = CATEGORY_COLORS[cat];
          return (
            <span className="flex items-center gap-1" key={cat}>
              <span
                className={`inline-block h-2 w-2 rounded-sm ${colors.bar}`}
              />
              <span className="text-[9px] text-zinc-500">
                {cat.replace("-", " ")}
              </span>
            </span>
          );
        })}
      </div>

      {/* Priority Items */}
      {priorityItems.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h4 className="font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
              Priority Items ({priorityItems.length})
            </h4>
            {priorityItems.length > 5 && (
              <button
                className="text-[10px] text-violet-400 hover:text-violet-300"
                onClick={() => setShowAllItems((prev) => !prev)}
                type="button"
              >
                {showAllItems ? "Show less" : "Show all"}
              </button>
            )}
          </div>
          <div className="space-y-1">
            {displayedItems.map((item) => {
              const catColors = CATEGORY_COLORS[item.category];
              const effortStyle =
                EFFORT_STYLES[item.effort] ?? EFFORT_STYLES.medium;
              return (
                <button
                  className="flex w-full items-start gap-2 rounded-md border border-zinc-800 bg-zinc-900/50 px-2.5 py-2 text-left transition-colors hover:bg-zinc-900"
                  key={item.id}
                  onClick={() => onItemClick?.(item)}
                  type="button"
                >
                  <span
                    className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 font-medium text-[9px] ${catColors.bg} ${catColors.text}`}
                  >
                    {item.category}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-zinc-300">{item.description}</p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">
                      {item.filePath}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-medium text-[9px] ${effortStyle}`}
                    >
                      {item.effort}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      {item.score}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
