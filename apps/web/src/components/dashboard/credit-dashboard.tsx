"use client";

import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreditUsagePoint {
  credits: number;
  timestamp: number;
}

export interface WorkerCreditBreakdown {
  credits: number;
  role: string;
  workerId: string;
}

interface CreditDashboardProps {
  burnRate?: number;
  orgCredits: number;
  projectedTotal?: number;
  sessionId: string;
  usageHistory: CreditUsagePoint[];
  workerBreakdown?: WorkerCreditBreakdown[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCredits(credits: number): string {
  if (credits >= 1000) {
    return `${(credits / 1000).toFixed(1)}k`;
  }
  return credits.toFixed(1);
}

function getUsageBarColor(percentage: number): string {
  if (percentage >= 95) {
    return "bg-red-500";
  }
  if (percentage >= 80) {
    return "bg-yellow-500";
  }
  return "bg-violet-500";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function UsageChart({ data }: { data: CreditUsagePoint[] }) {
  if (data.length < 2) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-zinc-600">
        Not enough data for chart
      </div>
    );
  }

  const maxCredits = Math.max(...data.map((d) => d.credits), 1);
  const minTime = data[0]?.timestamp ?? 0;
  const maxTime = data.at(-1)?.timestamp ?? 1;
  const timeRange = Math.max(maxTime - minTime, 1);

  const width = 400;
  const height = 120;
  const padding = { top: 8, right: 8, bottom: 20, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const points = data.map((d) => ({
    x: padding.left + ((d.timestamp - minTime) / timeRange) * plotWidth,
    y: padding.top + plotHeight - (d.credits / maxCredits) * plotHeight,
  }));

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  const areaD = `${pathD} L ${points.at(-1)?.x ?? 0} ${padding.top + plotHeight} L ${points[0]?.x ?? 0} ${padding.top + plotHeight} Z`;

  return (
    <svg
      className="w-full"
      preserveAspectRatio="xMidYMid meet"
      viewBox={`0 0 ${width} ${height}`}
    >
      <title>Credit Usage Chart</title>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((frac) => (
        <line
          key={`grid-${frac}`}
          stroke="#27272a"
          strokeWidth={0.5}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + plotHeight * (1 - frac)}
          y2={padding.top + plotHeight * (1 - frac)}
        />
      ))}

      {/* Y-axis labels */}
      {[0, 0.5, 1].map((frac) => (
        <text
          fill="#52525b"
          fontSize={8}
          key={`label-${frac}`}
          textAnchor="end"
          x={padding.left - 4}
          y={padding.top + plotHeight * (1 - frac) + 3}
        >
          {formatCredits(maxCredits * frac)}
        </text>
      ))}

      {/* Area fill */}
      <path d={areaD} fill="url(#credit-gradient)" opacity={0.3} />

      {/* Line */}
      <path d={pathD} fill="none" stroke="#8b5cf6" strokeWidth={1.5} />

      {/* Gradient definition */}
      <defs>
        <linearGradient id="credit-gradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
        </linearGradient>
      </defs>
    </svg>
  );
}

function WarningBanner({ percentage }: { percentage: number }) {
  if (percentage < 80) {
    return null;
  }

  const isCritical = percentage >= 95;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
        isCritical
          ? "border-red-500/30 bg-red-500/10"
          : "border-yellow-500/30 bg-yellow-500/10"
      }`}
    >
      <svg
        aria-hidden="true"
        className={`h-4 w-4 ${isCritical ? "text-red-400" : "text-yellow-400"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className={`text-xs ${isCritical ? "text-red-300" : "text-yellow-300"}`}
      >
        {isCritical
          ? `Credit limit nearly reached (${percentage.toFixed(0)}% used)`
          : `Credit usage is high (${percentage.toFixed(0)}% used)`}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CreditDashboard({
  sessionId: _sessionId,
  orgCredits,
  usageHistory,
  burnRate = 0,
  projectedTotal = 0,
  workerBreakdown = [],
}: CreditDashboardProps) {
  const totalUsed = useMemo(() => {
    if (usageHistory.length === 0) {
      return 0;
    }
    return usageHistory.at(-1)?.credits ?? 0;
  }, [usageHistory]);

  const usagePercentage = orgCredits > 0 ? (totalUsed / orgCredits) * 100 : 0;

  return (
    <div className="flex flex-col gap-4 bg-zinc-950 p-4">
      {/* Warning banner */}
      <WarningBanner percentage={usagePercentage} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="text-[10px] text-zinc-500">Credits Used</div>
          <div className="mt-1 font-mono text-lg text-zinc-100">
            {formatCredits(totalUsed)}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="text-[10px] text-zinc-500">Remaining</div>
          <div className="mt-1 font-mono text-lg text-zinc-100">
            {formatCredits(Math.max(0, orgCredits - totalUsed))}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="text-[10px] text-zinc-500">Burn Rate</div>
          <div className="mt-1 font-mono text-lg text-zinc-100">
            {formatCredits(burnRate)}
            <span className="text-xs text-zinc-500">/min</span>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="text-[10px] text-zinc-500">Projected Total</div>
          <div
            className={`mt-1 font-mono text-lg ${
              projectedTotal > orgCredits ? "text-red-400" : "text-zinc-100"
            }`}
          >
            {formatCredits(projectedTotal)}
          </div>
        </div>
      </div>

      {/* Usage bar */}
      <div>
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span>Usage</span>
          <span>{usagePercentage.toFixed(1)}%</span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-500 ${getUsageBarColor(
              usagePercentage
            )}`}
            style={{ width: `${Math.min(100, usagePercentage)}%` }}
          />
        </div>
      </div>

      {/* Usage chart */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="mb-2 font-medium text-[10px] text-zinc-500">
          Credit Usage Over Time
        </div>
        <UsageChart data={usageHistory} />
      </div>

      {/* Per-worker breakdown */}
      {workerBreakdown.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="mb-2 font-medium text-[10px] text-zinc-500">
            Per-Worker Breakdown
          </div>
          <div className="space-y-1.5">
            {workerBreakdown.map((w) => {
              const pct = totalUsed > 0 ? (w.credits / totalUsed) * 100 : 0;
              return (
                <div className="flex items-center gap-2" key={w.workerId}>
                  <span className="w-24 truncate text-xs text-zinc-400">
                    {w.role}
                  </span>
                  <div className="flex-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-violet-500/60"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="w-12 text-right font-mono text-[10px] text-zinc-500">
                    {formatCredits(w.credits)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
