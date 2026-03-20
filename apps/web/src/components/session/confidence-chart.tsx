"use client";

import { useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfidencePoint {
  factors?: Record<string, number>;
  iteration: number;
  timestamp: string;
  value: number;
}

interface ConfidenceChartProps {
  confidenceHistory: ConfidencePoint[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHART_WIDTH = 400;
const CHART_HEIGHT = 160;
const PADDING = { top: 12, right: 12, bottom: 24, left: 40 };
const PLOT_W = CHART_WIDTH - PADDING.left - PADDING.right;
const PLOT_H = CHART_HEIGHT - PADDING.top - PADDING.bottom;

// Color zones
const ZONE_GREEN = "#22c55e";
const ZONE_YELLOW = "#eab308";
const ZONE_RED = "#ef4444";

function getConfidenceColor(value: number): string {
  if (value > 0.7) {
    return ZONE_GREEN;
  }
  if (value > 0.4) {
    return ZONE_YELLOW;
  }
  return ZONE_RED;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfidenceChart({ confidenceHistory }: ConfidenceChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const maxIteration = useMemo(() => {
    if (confidenceHistory.length === 0) {
      return 1;
    }
    return Math.max(...confidenceHistory.map((p) => p.iteration), 1);
  }, [confidenceHistory]);

  const points = useMemo(
    () =>
      confidenceHistory.map((p) => ({
        x: PADDING.left + (p.iteration / maxIteration) * PLOT_W,
        y: PADDING.top + PLOT_H - p.value * PLOT_H,
        value: p.value,
        factors: p.factors,
        iteration: p.iteration,
        timestamp: p.timestamp,
      })),
    [confidenceHistory, maxIteration]
  );

  const pathD = useMemo(() => {
    if (points.length === 0) {
      return "";
    }
    return points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");
  }, [points]);

  if (confidenceHistory.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-xs text-zinc-600">
        No confidence data yet
      </div>
    );
  }

  const hoveredPoint = hoveredIdx === null ? null : points[hoveredIdx];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-medium text-[10px] text-zinc-500">
          Confidence Over Iterations
        </span>
        {hoveredPoint && (
          <span
            className="font-mono text-xs"
            style={{ color: getConfidenceColor(hoveredPoint.value) }}
          >
            {(hoveredPoint.value * 100).toFixed(1)}%
          </span>
        )}
      </div>

      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: SVG chart needs mouse interaction for hover tooltips */}
      <svg
        aria-label="Confidence over iterations chart"
        className="w-full"
        onMouseLeave={() => setHoveredIdx(null)}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        {/* Color zone backgrounds */}
        <rect
          fill={ZONE_GREEN}
          height={0.3 * PLOT_H}
          opacity={0.05}
          width={PLOT_W}
          x={PADDING.left}
          y={PADDING.top}
        />
        <rect
          fill={ZONE_YELLOW}
          height={0.3 * PLOT_H}
          opacity={0.05}
          width={PLOT_W}
          x={PADDING.left}
          y={PADDING.top + 0.3 * PLOT_H}
        />
        <rect
          fill={ZONE_RED}
          height={0.4 * PLOT_H}
          opacity={0.05}
          width={PLOT_W}
          x={PADDING.left}
          y={PADDING.top + 0.6 * PLOT_H}
        />

        {/* Threshold lines */}
        <line
          stroke={ZONE_GREEN}
          strokeDasharray="4 4"
          strokeOpacity={0.3}
          strokeWidth={0.5}
          x1={PADDING.left}
          x2={PADDING.left + PLOT_W}
          y1={PADDING.top + PLOT_H * 0.3}
          y2={PADDING.top + PLOT_H * 0.3}
        />
        <line
          stroke={ZONE_YELLOW}
          strokeDasharray="4 4"
          strokeOpacity={0.3}
          strokeWidth={0.5}
          x1={PADDING.left}
          x2={PADDING.left + PLOT_W}
          y1={PADDING.top + PLOT_H * 0.6}
          y2={PADDING.top + PLOT_H * 0.6}
        />

        {/* Y-axis labels */}
        <text
          fill="#52525b"
          fontSize={8}
          textAnchor="end"
          x={PADDING.left - 4}
          y={PADDING.top + 3}
        >
          100%
        </text>
        <text
          fill="#52525b"
          fontSize={8}
          textAnchor="end"
          x={PADDING.left - 4}
          y={PADDING.top + PLOT_H * 0.3 + 3}
        >
          70%
        </text>
        <text
          fill="#52525b"
          fontSize={8}
          textAnchor="end"
          x={PADDING.left - 4}
          y={PADDING.top + PLOT_H * 0.6 + 3}
        >
          40%
        </text>
        <text
          fill="#52525b"
          fontSize={8}
          textAnchor="end"
          x={PADDING.left - 4}
          y={PADDING.top + PLOT_H + 3}
        >
          0%
        </text>

        {/* Confidence line */}
        {pathD && (
          <path d={pathD} fill="none" stroke="#8b5cf6" strokeWidth={1.5} />
        )}

        {/* Points with color coding */}
        {points.map((p, i) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: SVG circle used for chart hover interaction
          <circle
            className="cursor-pointer"
            cx={p.x}
            cy={p.y}
            fill={getConfidenceColor(p.value)}
            key={`point-${p.iteration}`}
            onMouseEnter={() => setHoveredIdx(i)}
            r={hoveredIdx === i ? 5 : 3}
            stroke="#09090b"
            strokeWidth={1.5}
          />
        ))}

        {/* Hover tooltip */}
        {hoveredPoint && (
          <g>
            <line
              stroke="#52525b"
              strokeDasharray="2 2"
              strokeWidth={0.5}
              x1={hoveredPoint.x}
              x2={hoveredPoint.x}
              y1={PADDING.top}
              y2={PADDING.top + PLOT_H}
            />
          </g>
        )}
      </svg>

      {/* Factor breakdown on hover */}
      {hoveredPoint?.factors &&
        Object.keys(hoveredPoint.factors).length > 0 && (
          <div className="mt-2 rounded bg-zinc-800/50 p-2">
            <div className="text-[10px] text-zinc-500">
              Iteration {hoveredPoint.iteration} factors:
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
              {Object.entries(hoveredPoint.factors).map(([factor, value]) => (
                <div className="flex items-center justify-between" key={factor}>
                  <span className="text-[10px] text-zinc-400">{factor}</span>
                  <span
                    className="font-mono text-[10px]"
                    style={{ color: getConfidenceColor(value) }}
                  >
                    {(value * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
    </div>
  );
}
