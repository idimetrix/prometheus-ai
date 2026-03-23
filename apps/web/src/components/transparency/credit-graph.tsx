"use client";

import { useMemo } from "react";
import { useSessionStore } from "@/stores/session.store";

interface CreditGraphProps {
  height?: number;
  width?: number;
}

export function CreditGraph({ width = 200, height = 60 }: CreditGraphProps) {
  const creditHistory = useSessionStore((s) => s.creditHistory);

  const { pathD, areaD, maxCredits, latestCredits } = useMemo(() => {
    if (creditHistory.length === 0) {
      return { pathD: "", areaD: "", maxCredits: 0, latestCredits: 0 };
    }

    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const credits = creditHistory.map((e) => e.credits);
    const max = Math.max(...credits, 1);
    const latest = credits.at(-1) ?? 0;

    const points = creditHistory.map((entry, idx) => {
      const x =
        padding + (idx / Math.max(creditHistory.length - 1, 1)) * chartWidth;
      const y = padding + chartHeight - (entry.credits / max) * chartHeight;
      return { x, y };
    });

    const lineSegments = points.map((p, i) =>
      i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
    );
    const linePath = lineSegments.join(" ");

    const areaPath = `${linePath} L ${points.at(-1)?.x ?? 0} ${padding + chartHeight} L ${points[0]?.x ?? 0} ${padding + chartHeight} Z`;

    return {
      pathD: linePath,
      areaD: areaPath,
      maxCredits: max,
      latestCredits: latest,
    };
  }, [creditHistory, width, height]);

  if (creditHistory.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-md border border-zinc-800 bg-zinc-900/50"
        style={{ width, height }}
      >
        <span className="text-xs text-zinc-600">No credit data</span>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
          Credits
        </span>
        <span className="font-mono text-xs text-zinc-400">
          {latestCredits.toFixed(2)}
        </span>
      </div>
      <svg
        className="w-full"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
      >
        <title>Credit consumption sparkline</title>
        <defs>
          <linearGradient
            id="credit-gradient"
            x1="0%"
            x2="0%"
            y1="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="rgb(139, 92, 246)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="rgb(139, 92, 246)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Area fill */}
        <path d={areaD} fill="url(#credit-gradient)" />
        {/* Line */}
        <path
          d={pathD}
          fill="none"
          stroke="rgb(139, 92, 246)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-700">
        <span>
          {new Date(creditHistory[0]?.timestamp ?? 0).toLocaleTimeString()}
        </span>
        <span>max: {maxCredits.toFixed(2)}</span>
      </div>
    </div>
  );
}
