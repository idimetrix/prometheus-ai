"use client";

import { Card, CardContent } from "@prometheus/ui";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bug,
  CheckCircle,
  FileCode,
  ShieldCheck,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface QualityDataPoint {
  date: string;
  lintErrors: number;
  testCoverage: number;
  typeCoverage: number;
}

export interface QualitySummary {
  lintErrors: number;
  lintErrorsPrev: number;
  testCoverage: number;
  testCoveragePrev: number;
  typeCoverage: number;
  typeCoveragePrev: number;
}

interface CodeQualityTabProps {
  data: QualityDataPoint[];
  period?: "week" | "month";
  summary: QualitySummary;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatDelta(
  current: number,
  previous: number
): {
  color: string;
  direction: "up" | "down" | "flat";
  label: string;
} {
  const diff = current - previous;
  if (Math.abs(diff) < 0.1) {
    return { direction: "flat", label: "No change", color: "text-zinc-500" };
  }
  if (diff > 0) {
    return {
      direction: "up",
      label: `+${diff.toFixed(1)}`,
      color: "text-green-400",
    };
  }
  return {
    direction: "down",
    label: diff.toFixed(1),
    color: "text-red-400",
  };
}

function formatDeltaInverse(
  current: number,
  previous: number
): {
  color: string;
  direction: "up" | "down" | "flat";
  label: string;
} {
  // For metrics where lower is better (lint errors)
  const diff = current - previous;
  if (Math.abs(diff) < 0.5) {
    return { direction: "flat", label: "No change", color: "text-zinc-500" };
  }
  if (diff < 0) {
    return {
      direction: "down",
      label: diff.toFixed(0),
      color: "text-green-400",
    };
  }
  return {
    direction: "up",
    label: `+${diff.toFixed(0)}`,
    color: "text-red-400",
  };
}

function DeltaArrow({ direction }: { direction: "up" | "down" | "flat" }) {
  if (direction === "up") {
    return <ArrowUp className="h-3 w-3" />;
  }
  if (direction === "down") {
    return <ArrowDown className="h-3 w-3" />;
  }
  return <ArrowRight className="h-3 w-3" />;
}

/* -------------------------------------------------------------------------- */
/*  Summary Card                                                               */
/* -------------------------------------------------------------------------- */

function SummaryCard({
  icon: Icon,
  iconBg,
  iconColor,
  label,
  value,
  unit,
  delta,
}: {
  delta: { color: string; direction: "up" | "down" | "flat"; label: string };
  icon: typeof CheckCircle;
  iconBg: string;
  iconColor: string;
  label: string;
  unit: string;
  value: number;
}) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-lg ${iconBg}`}
          >
            <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
          </div>
          <span className="font-medium text-muted-foreground text-xs">
            {label}
          </span>
        </div>
        <div className="mt-2 flex items-end justify-between">
          <div className="font-bold text-2xl text-foreground">
            {typeof value === "number" && unit === "%"
              ? `${value.toFixed(1)}%`
              : value}
            {unit !== "%" && (
              <span className="ml-1 font-normal text-muted-foreground text-sm">
                {unit}
              </span>
            )}
          </div>
          <div className={`flex items-center gap-0.5 text-xs ${delta.color}`}>
            <DeltaArrow direction={delta.direction} />
            <span>{delta.label}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Custom Recharts Tooltip                                                    */
/* -------------------------------------------------------------------------- */

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  label?: string;
  payload?: Array<{ color: string; name: string; value: number }>;
}) {
  if (!(active && payload?.length)) {
    return null;
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 shadow-lg">
      <p className="mb-1 font-mono text-[10px] text-zinc-500">{label}</p>
      {payload.map((entry) => (
        <div className="flex items-center gap-2 text-xs" key={entry.name}>
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-zinc-400">{entry.name}:</span>
          <span className="font-mono text-zinc-200">
            {entry.name === "Lint Errors" ? entry.value : `${entry.value}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  CodeQualityTab                                                             */
/* -------------------------------------------------------------------------- */

export function CodeQualityTab({
  data,
  summary,
  period = "week",
}: CodeQualityTabProps) {
  const testDelta = formatDelta(summary.testCoverage, summary.testCoveragePrev);
  const typeDelta = formatDelta(summary.typeCoverage, summary.typeCoveragePrev);
  const lintDelta = formatDeltaInverse(
    summary.lintErrors,
    summary.lintErrorsPrev
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          delta={testDelta}
          icon={CheckCircle}
          iconBg="bg-green-500/10"
          iconColor="text-green-500"
          label="Test Coverage"
          unit="%"
          value={summary.testCoverage}
        />
        <SummaryCard
          delta={lintDelta}
          icon={Bug}
          iconBg="bg-red-500/10"
          iconColor="text-red-500"
          label="Lint Errors"
          unit="errors"
          value={summary.lintErrors}
        />
        <SummaryCard
          delta={typeDelta}
          icon={ShieldCheck}
          iconBg="bg-blue-500/10"
          iconColor="text-blue-500"
          label="Type Coverage"
          unit="%"
          value={summary.typeCoverage}
        />
      </div>

      {/* Trend charts */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCode className="h-4 w-4 text-zinc-500" />
              <h4 className="font-medium text-sm text-zinc-200">
                Quality Trends
              </h4>
            </div>
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
              Past {period}
            </span>
          </div>

          {data.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-sm text-zinc-600">
              No trend data available
            </div>
          ) : (
            <div className="space-y-6">
              {/* Test Coverage + Type Coverage */}
              <div>
                <h5 className="mb-2 text-[10px] text-zinc-500 uppercase tracking-wider">
                  Coverage Trends (%)
                </h5>
                <ResponsiveContainer height={200} width="100%">
                  <AreaChart data={data}>
                    <CartesianGrid
                      stroke="#27272a"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      fontSize={10}
                      stroke="#52525b"
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      fontSize={10}
                      stroke="#52525b"
                      tickLine={false}
                      width={35}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      dataKey="testCoverage"
                      fill="#22c55e"
                      fillOpacity={0.1}
                      name="Test Coverage"
                      stroke="#22c55e"
                      strokeWidth={2}
                      type="monotone"
                    />
                    <Area
                      dataKey="typeCoverage"
                      fill="#3b82f6"
                      fillOpacity={0.1}
                      name="Type Coverage"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      type="monotone"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Lint Errors */}
              <div>
                <h5 className="mb-2 text-[10px] text-zinc-500 uppercase tracking-wider">
                  Lint Errors Count
                </h5>
                <ResponsiveContainer height={160} width="100%">
                  <AreaChart data={data}>
                    <CartesianGrid
                      stroke="#27272a"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      fontSize={10}
                      stroke="#52525b"
                      tickLine={false}
                    />
                    <YAxis
                      fontSize={10}
                      stroke="#52525b"
                      tickLine={false}
                      width={35}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      dataKey="lintErrors"
                      fill="#ef4444"
                      fillOpacity={0.1}
                      name="Lint Errors"
                      stroke="#ef4444"
                      strokeWidth={2}
                      type="monotone"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-6 text-[10px] text-zinc-500">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
          Test Coverage
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
          Type Coverage
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
          Lint Errors
        </div>
      </div>
    </div>
  );
}
