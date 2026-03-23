"use client";

import { Badge, Card, CardContent, Progress } from "@prometheus/ui";
import { useMemo } from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreditBreakdownItem {
  /** Category label (e.g. "Coder Agent", "Claude 3.5 Sonnet") */
  category: string;
  /** Credits consumed */
  credits: number;
}

export interface CreditUsageHistoryPoint {
  /** Credits consumed that period */
  consumed: number;
  /** Date label */
  date: string;
}

interface CreditUsageProps {
  /** Breakdown by agent type */
  agentBreakdown?: CreditBreakdownItem[];
  /** Current credit balance */
  balance: number;
  /** Daily burn rate (credits per day) */
  burnRatePerDay?: number;
  /** Usage history */
  history?: CreditUsageHistoryPoint[];
  /** Maximum credits (plan limit or total purchased) */
  maxCredits: number;
  /** Breakdown by model tier */
  modelBreakdown?: CreditBreakdownItem[];
  /** Callback when upgrade is clicked */
  onUpgrade?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIE_COLORS = [
  "#8b5cf6",
  "#22c55e",
  "#f59e0b",
  "#06b6d4",
  "#f43f5e",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

const LOW_CREDIT_THRESHOLD = 0.15;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCredits(credits: number): string {
  if (credits >= 1_000_000) {
    return `${(credits / 1_000_000).toFixed(1)}M`;
  }
  if (credits >= 1000) {
    return `${(credits / 1000).toFixed(1)}k`;
  }
  return String(Math.round(credits));
}

function daysRemaining(balance: number, burnRate: number): number {
  if (burnRate <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.floor(balance / burnRate);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BreakdownPieChart({ data }: { data: CreditBreakdownItem[] }) {
  const totalCredits = useMemo(
    () => data.reduce((sum, d) => sum + d.credits, 0),
    [data]
  );

  const chartData = useMemo(
    () =>
      data.map((d) => ({
        name: d.category,
        value: d.credits,
        percentage:
          totalCredits > 0
            ? ((d.credits / totalCredits) * 100).toFixed(1)
            : "0",
      })),
    [data, totalCredits]
  );

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-zinc-600">
        No breakdown data
      </div>
    );
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer height="100%" width="100%">
        <PieChart>
          <Pie
            cx="50%"
            cy="50%"
            data={chartData}
            dataKey="value"
            innerRadius={45}
            nameKey="name"
            outerRadius={75}
            paddingAngle={2}
            strokeWidth={0}
          >
            {chartData.map((_, idx) => (
              <Cell
                fill={PIE_COLORS[idx % PIE_COLORS.length]}
                key={`cell-${String(idx)}`}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "8px",
              fontSize: "11px",
            }}
            formatter={(value) => [
              `${formatCredits(Number(value))} credits`,
              "",
            ]}
          />
          <Legend
            formatter={(value: string) => (
              <span className="text-[10px] text-zinc-400">{value}</span>
            )}
            wrapperStyle={{ fontSize: "10px" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function BurnRateIndicator({
  balance,
  burnRate,
  onUpgrade,
}: {
  balance: number;
  burnRate: number;
  onUpgrade?: () => void;
}) {
  const days = daysRemaining(balance, burnRate);
  const isLow = days < 7;
  const isCritical = days < 3;

  function burnRateBorderClass(): string {
    if (isCritical) {
      return "border-red-500/30 bg-red-500/5";
    }
    if (isLow) {
      return "border-amber-500/30 bg-amber-500/5";
    }
    return "border-zinc-800 bg-zinc-900/50";
  }

  function burnRateTextColor(): string {
    if (isCritical) {
      return "text-red-400";
    }
    if (isLow) {
      return "text-amber-400";
    }
    return "text-green-400";
  }

  return (
    <div className={`rounded-lg border p-3 ${burnRateBorderClass()}`}>
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Burn Rate
          </span>
          <div className="mt-0.5 font-mono text-sm text-zinc-300">
            {formatCredits(burnRate)}{" "}
            <span className="text-zinc-600">credits/day</span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Projected Runway
          </span>
          <div className={`mt-0.5 font-mono text-sm ${burnRateTextColor()}`}>
            {days === Number.POSITIVE_INFINITY ? "Unlimited" : `${days} days`}
          </div>
        </div>
      </div>

      {(isCritical || isLow) && (
        <div className="mt-2 flex items-center justify-between">
          <span
            className={`text-xs ${isCritical ? "text-red-400" : "text-amber-400"}`}
          >
            {isCritical
              ? "Critical: Credits running out soon!"
              : "Low credit warning"}
          </span>
          {onUpgrade && (
            <button
              className="rounded bg-violet-500/20 px-2.5 py-1 font-medium text-[10px] text-violet-300 transition-colors hover:bg-violet-500/30"
              onClick={onUpgrade}
              type="button"
            >
              Upgrade Plan
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CreditUsage({
  balance,
  maxCredits,
  burnRatePerDay,
  agentBreakdown = [],
  modelBreakdown = [],
  history = [],
  onUpgrade,
}: CreditUsageProps) {
  const usagePercent = maxCredits > 0 ? (balance / maxCredits) * 100 : 0;
  const isLow = maxCredits > 0 && balance / maxCredits < LOW_CREDIT_THRESHOLD;

  return (
    <Card className="flex flex-col border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center gap-2 border-zinc-800 border-b px-4 py-3">
        <svg
          aria-hidden="true"
          className="h-4 w-4 text-violet-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 0 0 2.25-2.25V6.75A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25v10.5A2.25 2.25 0 0 0 4.5 19.5Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <h3 className="font-medium text-sm text-zinc-200">Credit Usage</h3>
        {isLow && (
          <Badge className="bg-red-500/20 text-red-400" variant="secondary">
            Low Balance
          </Badge>
        )}
      </div>

      <CardContent className="flex-1 overflow-auto p-4">
        {/* Balance display */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex items-end justify-between">
            <div>
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                Current Balance
              </span>
              <div
                className={`font-mono text-3xl ${isLow ? "text-red-400" : "text-zinc-200"}`}
              >
                {formatCredits(balance)}
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
                Plan Limit
              </span>
              <div className="font-mono text-sm text-zinc-400">
                {formatCredits(maxCredits)}
              </div>
            </div>
          </div>
          <div className="mt-3">
            <Progress className="h-2" value={usagePercent} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
            <span>{usagePercent.toFixed(1)}% remaining</span>
            <span>{formatCredits(maxCredits - balance)} used</span>
          </div>
        </div>

        {/* Burn rate */}
        {burnRatePerDay !== undefined && (
          <div className="mt-4">
            <BurnRateIndicator
              balance={balance}
              burnRate={burnRatePerDay}
              onUpgrade={onUpgrade}
            />
          </div>
        )}

        {/* Breakdowns side by side */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          {agentBreakdown.length > 0 && (
            <div>
              <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                By Agent Type
              </h4>
              <BreakdownPieChart data={agentBreakdown} />
            </div>
          )}
          {modelBreakdown.length > 0 && (
            <div>
              <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                By Model Tier
              </h4>
              <BreakdownPieChart data={modelBreakdown} />
            </div>
          )}
        </div>

        {/* Usage history */}
        {history.length > 0 && (
          <div className="mt-6">
            <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
              Usage Over Time
            </h4>
            <div className="h-40 w-full">
              <ResponsiveContainer height="100%" width="100%">
                <LineChart data={history}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    fontSize={10}
                    stroke="#52525b"
                    tick={{ fill: "#71717a" }}
                  />
                  <YAxis
                    fontSize={10}
                    stroke="#52525b"
                    tick={{ fill: "#71717a" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #27272a",
                      borderRadius: "8px",
                      fontSize: "11px",
                    }}
                    formatter={(value) => [
                      `${formatCredits(Number(value))} credits`,
                      "Consumed",
                    ]}
                  />
                  <Line
                    dataKey="consumed"
                    dot={false}
                    name="Credits Consumed"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    type="monotone"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
