"use client";

import { useMemo } from "react";

interface CreditDataPoint {
  balance: number;
  consumed: number;
  date: string;
  granted: number;
}

interface CreditChartProps {
  data: CreditDataPoint[];
  title?: string;
}

export function CreditChart({
  data,
  title = "Credit Consumption",
}: CreditChartProps) {
  const maxValue = useMemo(
    () =>
      Math.max(
        ...data.map((d) => Math.max(d.consumed, d.granted, d.balance)),
        1
      ),
    [data]
  );

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground text-sm">
        No credit data available
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-4 font-medium text-sm">{title}</h3>
      <div className="flex h-48 items-end gap-1">
        {data.map((point) => (
          <div
            className="group relative flex flex-1 flex-col items-center justify-end"
            key={point.date}
          >
            {/* Consumed bar */}
            <div
              className="w-full rounded-t bg-destructive/70 transition-all hover:bg-destructive"
              style={{
                height: `${(point.consumed / maxValue) * 100}%`,
                minHeight: point.consumed > 0 ? "2px" : "0",
              }}
            />
            {/* Tooltip */}
            <div className="absolute -top-16 left-1/2 z-10 hidden -translate-x-1/2 rounded bg-popover p-2 text-xs shadow-md group-hover:block">
              <div>{point.date}</div>
              <div>Consumed: {point.consumed}</div>
              <div>Granted: {point.granted}</div>
              <div>Balance: {point.balance}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-muted-foreground text-xs">
        <span>{data[0]?.date}</span>
        <span>{data.at(-1)?.date}</span>
      </div>
    </div>
  );
}
