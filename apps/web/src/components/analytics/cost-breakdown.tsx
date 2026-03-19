"use client";

import { useMemo } from "react";

interface CostItem {
  category: string;
  costUsd: number;
  percentage: number;
}

interface CostBreakdownProps {
  cascadeSavingsUsd?: number;
  data: CostItem[];
  freeUtilizationPercent?: number;
  title?: string;
}

const COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-yellow-500",
  "bg-purple-500",
  "bg-pink-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-red-500",
];

export function CostBreakdown({
  data,
  title = "Cost Breakdown",
  cascadeSavingsUsd,
  freeUtilizationPercent,
}: CostBreakdownProps) {
  const totalCost = useMemo(
    () => data.reduce((sum, item) => sum + item.costUsd, 0),
    [data]
  );

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground text-sm">
        No cost data available
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-4 font-medium text-sm">{title}</h3>
      <div className="mb-4 font-bold text-2xl">${totalCost.toFixed(2)}</div>

      {/* Stacked bar */}
      <div className="mb-4 flex h-4 overflow-hidden rounded-full">
        {data.map((item, i) => (
          <div
            className={`${COLORS[i % COLORS.length]} transition-all`}
            key={item.category}
            style={{ width: `${item.percentage}%` }}
            title={`${item.category}: $${item.costUsd.toFixed(2)} (${item.percentage.toFixed(1)}%)`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="space-y-1.5">
        {data.map((item, i) => (
          <div
            className="flex items-center justify-between text-sm"
            key={item.category}
          >
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-3 w-3 rounded-sm ${COLORS[i % COLORS.length]}`}
              />
              <span className="text-muted-foreground">{item.category}</span>
            </div>
            <span className="font-medium">
              ${item.costUsd.toFixed(2)} ({item.percentage.toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>

      {/* Cascade Routing Savings */}
      {(cascadeSavingsUsd != null || freeUtilizationPercent != null) && (
        <div className="mt-4 rounded-md border border-green-900/50 bg-green-950/30 p-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-green-400">Cascade routing savings</span>
            <div className="flex items-center gap-3">
              {freeUtilizationPercent != null && (
                <span className="text-green-300">
                  {freeUtilizationPercent.toFixed(0)}% free models
                </span>
              )}
              {cascadeSavingsUsd != null && (
                <span className="font-medium text-green-300">
                  ~${cascadeSavingsUsd.toFixed(2)} saved
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
