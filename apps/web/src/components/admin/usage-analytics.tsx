"use client";

import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DailyUsage {
  credits: number;
  date: string;
  sessions: number;
  tokens: number;
}

export interface CostBreakdown {
  category: string;
  cost: number;
  percentage: number;
}

export interface ROIMetrics {
  qualityImprovement: number;
  tasksAutomated: number;
  timeSavedHours: number;
}

export interface UsageAnalyticsProps {
  costBreakdowns?: CostBreakdown[];
  dailyUsage?: DailyUsage[];
  roi?: ROIMetrics;
}

// ---------------------------------------------------------------------------
// UsageAnalytics
// ---------------------------------------------------------------------------

export function UsageAnalytics({
  dailyUsage = [],
  costBreakdowns = [],
  roi,
}: UsageAnalyticsProps) {
  const [timeRange, setTimeRange] = useState<"7d" | "30d" | "90d">("30d");

  const filteredUsage = useMemo(() => {
    let days = 90;
    if (timeRange === "7d") {
      days = 7;
    } else if (timeRange === "30d") {
      days = 30;
    }
    return dailyUsage.slice(-days);
  }, [dailyUsage, timeRange]);

  const totals = useMemo(() => {
    return filteredUsage.reduce(
      (acc, day) => ({
        sessions: acc.sessions + day.sessions,
        tokens: acc.tokens + day.tokens,
        credits: acc.credits + day.credits,
      }),
      { sessions: 0, tokens: 0, credits: 0 }
    );
  }, [filteredUsage]);

  const maxSessions = useMemo(
    () => Math.max(1, ...filteredUsage.map((d) => d.sessions)),
    [filteredUsage]
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-lg text-zinc-100">Usage Analytics</h2>
        <div className="flex gap-1">
          {(["7d", "30d", "90d"] as const).map((range) => (
            <button
              className={`rounded px-3 py-1 text-xs transition-colors ${
                timeRange === range
                  ? "bg-violet-600 text-white"
                  : "text-zinc-400 hover:bg-zinc-800"
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

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Total Sessions" value={totals.sessions} />
        <SummaryCard
          label="Tokens Consumed"
          value={formatNumber(totals.tokens)}
        />
        <SummaryCard label="Credits Used" value={totals.credits} />
      </div>

      {/* Sessions Chart (bar chart via CSS) */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h3 className="mb-4 font-medium text-sm text-zinc-200">
          Sessions Per Day
        </h3>
        <div className="flex h-40 items-end gap-px">
          {filteredUsage.map((day) => (
            <div
              className="group relative flex-1"
              key={day.date}
              title={`${day.date}: ${day.sessions} sessions`}
            >
              <div
                className="w-full rounded-t bg-violet-600 transition-colors group-hover:bg-violet-500"
                style={{
                  height: `${(day.sessions / maxSessions) * 100}%`,
                  minHeight: day.sessions > 0 ? "2px" : "0",
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-xs text-zinc-600">
          <span>{filteredUsage[0]?.date ?? ""}</span>
          <span>{filteredUsage.at(-1)?.date ?? ""}</span>
        </div>
      </div>

      {/* Cost Breakdown */}
      {costBreakdowns.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <h3 className="mb-4 font-medium text-sm text-zinc-200">
            Cost Breakdown
          </h3>
          <div className="flex flex-col gap-3">
            {costBreakdowns.map((item) => (
              <div className="flex flex-col gap-1" key={item.category}>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-300">{item.category}</span>
                  <span className="font-mono text-sm text-zinc-200">
                    ${item.cost.toFixed(2)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-violet-600"
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ROI Metrics */}
      {roi && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <h3 className="mb-4 font-medium text-sm text-zinc-200">
            ROI Metrics
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <p className="font-bold text-2xl text-green-400">
                {roi.timeSavedHours}h
              </p>
              <p className="text-xs text-zinc-500">Time Saved</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-2xl text-violet-400">
                {roi.tasksAutomated}
              </p>
              <p className="text-xs text-zinc-500">Tasks Automated</p>
            </div>
            <div className="text-center">
              <p className="font-bold text-2xl text-amber-400">
                +{roi.qualityImprovement}%
              </p>
              <p className="text-xs text-zinc-500">Quality Improvement</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-sm text-zinc-500">{label}</p>
      <p className="font-bold text-2xl text-zinc-100">{value}</p>
    </div>
  );
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return String(num);
}
