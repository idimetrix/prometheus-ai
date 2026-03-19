"use client";

import { Card, CardContent } from "@prometheus/ui";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import type { ComponentType } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface MetricCardProps {
  icon: ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  label: string;
  subtitle?: string;
  trend?: number[];
  trendDirection?: "up" | "down" | "flat";
  value: string | number;
}

/* -------------------------------------------------------------------------- */
/*  Sparkline (SVG polyline)                                                   */
/* -------------------------------------------------------------------------- */

function Sparkline({
  data,
  direction,
}: {
  data: number[];
  direction?: "up" | "down" | "flat";
}) {
  if (data.length < 2) {
    return null;
  }

  const width = 80;
  const height = 28;
  const padding = 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((value, index) => {
      const x = padding + (index / (data.length - 1)) * (width - padding * 2);
      const y =
        height - padding - ((value - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  let strokeColor = "#a1a1aa";
  if (direction === "up") {
    strokeColor = "#22c55e";
  } else if (direction === "down") {
    strokeColor = "#ef4444";
  }

  const fillId = `sparkline-grad-${data.join("-").slice(0, 20)}`;

  // Build area path for gradient fill
  const firstX = padding;
  const lastX =
    padding + ((data.length - 1) / (data.length - 1)) * (width - padding * 2);
  const areaPoints = `${firstX},${height} ${points} ${lastX},${height}`;

  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: decorative sparkline
    <svg
      className="shrink-0"
      height={height}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      <defs>
        <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.2" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${fillId})`} points={areaPoints} />
      <polyline
        fill="none"
        points={points}
        stroke={strokeColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Trend Arrow                                                                */
/* -------------------------------------------------------------------------- */

function TrendArrow({ direction }: { direction: "up" | "down" | "flat" }) {
  if (direction === "up") {
    return <ArrowUp className="h-3 w-3 text-green-500" />;
  }
  if (direction === "down") {
    return <ArrowDown className="h-3 w-3 text-red-500" />;
  }
  return <ArrowRight className="h-3 w-3 text-zinc-500" />;
}

/* -------------------------------------------------------------------------- */
/*  MetricCard                                                                 */
/* -------------------------------------------------------------------------- */

export function MetricCard({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  subtitle,
  trend,
  trendDirection,
  value,
}: MetricCardProps) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/50 p-5">
      <CardContent className="p-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconBg}`}
            >
              <Icon className={`h-4 w-4 ${iconColor}`} />
            </div>
            <span className="font-medium text-xs text-zinc-500">{label}</span>
          </div>
          {trendDirection && <TrendArrow direction={trendDirection} />}
        </div>

        <div className="mt-3 flex items-end justify-between">
          <div>
            <div className="font-bold text-3xl text-zinc-100">{value}</div>
            {subtitle && (
              <div className="mt-1 text-xs text-zinc-500">{subtitle}</div>
            )}
          </div>
          {trend && trend.length >= 2 && (
            <Sparkline data={trend} direction={trendDirection} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
