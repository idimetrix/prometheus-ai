"use client";

import { useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface CostEntry {
  amount: number;
  category: string;
  date: string;
  model: string;
  role: string;
}

interface PeriodSummary {
  byModel: Array<{ amount: number; model: string }>;
  byRole: Array<{ amount: number; role: string }>;
  periodLabel: string;
  total: number;
}

type Period = "7d" | "30d" | "90d";

interface CostAnalyticsDashboardProps {
  className?: string;
  creditBalance?: number;
  currentPeriod: PeriodSummary;
  entries: CostEntry[];
  previousPeriod?: PeriodSummary;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function percentChange(current: number, previous: number): string {
  if (previous === 0) {
    return current > 0 ? "+100%" : "0%";
  }
  const pct = ((current - previous) / previous) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

/* -------------------------------------------------------------------------- */
/*  Horizontal bar                                                             */
/* -------------------------------------------------------------------------- */

function HorizontalBar({
  items,
  maxValue,
}: {
  items: Array<{ amount: number; label: string }>;
  maxValue: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => (
        <div className="flex items-center gap-2" key={item.label}>
          <span className="w-20 shrink-0 truncate text-xs text-zinc-400">
            {item.label}
          </span>
          <div className="flex-1">
            <div className="h-4 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-blue-500/70"
                style={{
                  width:
                    maxValue > 0 ? `${(item.amount / maxValue) * 100}%` : "0%",
                }}
              />
            </div>
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-xs text-zinc-400">
            {formatCurrency(item.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function CostAnalyticsDashboard({
  currentPeriod,
  previousPeriod,
  entries,
  creditBalance,
  className = "",
}: CostAnalyticsDashboardProps) {
  const [period, setPeriod] = useState<Period>("30d");

  const dailyCosts = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      map.set(entry.date, (map.get(entry.date) ?? 0) + entry.amount);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ amount, date }));
  }, [entries]);

  const modelMax = Math.max(...currentPeriod.byModel.map((m) => m.amount), 1);
  const roleMax = Math.max(...currentPeriod.byRole.map((r) => r.amount), 1);

  const changeText = previousPeriod
    ? percentChange(currentPeriod.total, previousPeriod.total)
    : null;

  const changePositive =
    previousPeriod !== undefined && currentPeriod.total <= previousPeriod.total;

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Period selector and summary */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm text-zinc-200">
            Cost Analytics
          </h3>
          <span className="text-xs text-zinc-500">
            {currentPeriod.periodLabel}
          </span>
        </div>
        <div className="flex gap-1">
          {(["7d", "30d", "90d"] as const).map((p) => (
            <button
              className={`rounded px-2 py-1 text-xs ${
                period === p
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
              key={p}
              onClick={() => setPeriod(p)}
              type="button"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
          <span className="text-xs text-zinc-500">Total Spend</span>
          <div className="mt-1 font-bold text-2xl text-zinc-100">
            {formatCurrency(currentPeriod.total)}
          </div>
          {changeText && (
            <span
              className={`text-xs ${changePositive ? "text-green-400" : "text-red-400"}`}
            >
              {changeText} vs prev
            </span>
          )}
        </div>
        {creditBalance !== undefined && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
            <span className="text-xs text-zinc-500">Credit Balance</span>
            <div className="mt-1 font-bold text-2xl text-zinc-100">
              {formatCurrency(creditBalance)}
            </div>
          </div>
        )}
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
          <span className="text-xs text-zinc-500">Avg Daily</span>
          <div className="mt-1 font-bold text-2xl text-zinc-100">
            {formatCurrency(
              dailyCosts.length > 0
                ? currentPeriod.total / dailyCosts.length
                : 0
            )}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
          <span className="text-xs text-zinc-500">Models Used</span>
          <div className="mt-1 font-bold text-2xl text-zinc-100">
            {currentPeriod.byModel.length}
          </div>
        </div>
      </div>

      {/* Breakdown */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* By model */}
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
          <span className="mb-3 block text-xs text-zinc-500">
            Cost by Model
          </span>
          <HorizontalBar
            items={currentPeriod.byModel.map((m) => ({
              amount: m.amount,
              label: m.model,
            }))}
            maxValue={modelMax}
          />
        </div>

        {/* By role */}
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-4">
          <span className="mb-3 block text-xs text-zinc-500">Cost by Role</span>
          <HorizontalBar
            items={currentPeriod.byRole.map((r) => ({
              amount: r.amount,
              label: r.role,
            }))}
            maxValue={roleMax}
          />
        </div>
      </div>
    </div>
  );
}

export type { CostAnalyticsDashboardProps, CostEntry, PeriodSummary };
