"use client";

import { Badge, Card, CardContent } from "@prometheus/ui";
import { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
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

export interface AgentStat {
  /** Average task duration in seconds */
  avgTimeSec: number;
  /** Total cost in USD */
  costUsd: number;
  /** Agent display name / role */
  role: string;
  /** Success rate 0-100 */
  successRate: number;
  /** Total tasks completed */
  tasksCompleted: number;
  /** Total tokens consumed */
  tokensUsed: number;
}

export interface TrendPoint {
  /** Cost in USD for that day */
  costUsd?: number;
  /** Date label */
  date: string;
  /** Average success rate across all agents */
  successRate: number;
  /** Tasks completed that day */
  tasksCompleted: number;
  /** Token usage for that day */
  tokensUsed?: number;
}

type ViewMode = "chart" | "table";
type SortField = keyof Pick<
  AgentStat,
  | "role"
  | "tasksCompleted"
  | "successRate"
  | "avgTimeSec"
  | "tokensUsed"
  | "costUsd"
>;
type SortDirection = "asc" | "desc";

interface DateRangeOption {
  label: string;
  value: string;
}

interface AgentPerformanceProps {
  /** Roles to compare side-by-side (exactly 2 for comparison mode) */
  compareRoles?: [string, string];
  /** Available date range presets */
  dateRanges?: DateRangeOption[];
  /** Callback when comparison roles change */
  onCompareChange?: (roles: [string, string] | null) => void;
  /** Callback when date range changes */
  onDateRangeChange?: (range: string) => void;
  /** Callback when role filter changes */
  onRoleFilter?: (role: string) => void;
  /** Per-agent statistics */
  stats: AgentStat[];
  /** Performance trend over time */
  trend?: TrendPoint[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DATE_RANGES: DateRangeOption[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

const _ROLE_COLORS: Record<string, string> = {
  architect: "#8b5cf6",
  coder: "#22c55e",
  reviewer: "#f59e0b",
  tester: "#06b6d4",
  deployer: "#f43f5e",
  planner: "#6366f1",
  orchestrator: "#a855f7",
  "frontend-coder": "#06b6d4",
  "backend-coder": "#22c55e",
  "security-auditor": "#ef4444",
};

const _BAR_COLORS = [
  "#8b5cf6",
  "#22c55e",
  "#f59e0b",
  "#06b6d4",
  "#f43f5e",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

const PIE_COLORS = ["#22c55e", "#ef4444"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return String(count);
}

function successRateColor(rate: number): string {
  if (rate >= 80) {
    return "text-green-400";
  }
  if (rate >= 60) {
    return "text-amber-400";
  }
  return "text-red-400";
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  return `${minutes}m ${remaining}s`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SortHeader({
  children,
  field,
  sortDirection,
  sortField,
  onSort,
}: {
  children: React.ReactNode;
  field: SortField;
  onSort: (field: SortField) => void;
  sortDirection: SortDirection;
  sortField: SortField;
}) {
  const isActive = sortField === field;
  return (
    <button
      className="flex items-center gap-1 text-left text-[10px] text-zinc-500 uppercase tracking-wider hover:text-zinc-300"
      onClick={() => onSort(field)}
      type="button"
    >
      {children}
      {isActive && (
        <span className="text-violet-400">
          {sortDirection === "asc" ? "^" : "v"}
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentPerformance({
  stats,
  trend = [],
  dateRanges = DEFAULT_DATE_RANGES,
  onDateRangeChange,
  onRoleFilter,
  compareRoles,
  onCompareChange,
}: AgentPerformanceProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("chart");
  const [selectedRange, setSelectedRange] = useState(
    dateRanges[0]?.value ?? "7d"
  );
  const [sortField, setSortField] = useState<SortField>("tasksCompleted");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [roleFilter, setRoleFilter] = useState("");
  const [compareA, setCompareA] = useState(compareRoles?.[0] ?? "");
  const [compareB, setCompareB] = useState(compareRoles?.[1] ?? "");

  const handleRangeChange = useCallback(
    (range: string) => {
      setSelectedRange(range);
      onDateRangeChange?.(range);
    },
    [onDateRangeChange]
  );

  const handleRoleFilter = useCallback(
    (role: string) => {
      setRoleFilter(role);
      onRoleFilter?.(role);
    },
    [onRoleFilter]
  );

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDirection("desc");
      }
    },
    [sortField]
  );

  const filteredStats = useMemo(() => {
    const filtered = roleFilter
      ? stats.filter((s) => s.role === roleFilter)
      : stats;
    return [...filtered].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      const numA = Number(aVal);
      const numB = Number(bVal);
      return sortDirection === "asc" ? numA - numB : numB - numA;
    });
  }, [stats, roleFilter, sortField, sortDirection]);

  const availableRoles = useMemo(
    () => [...new Set(stats.map((s) => s.role))].sort(),
    [stats]
  );

  const barData = useMemo(
    () =>
      filteredStats.map((s) => ({
        name: s.role,
        "Tasks Completed": s.tasksCompleted,
        "Success Rate": s.successRate,
        "Avg Time (s)": Math.round(s.avgTimeSec),
      })),
    [filteredStats]
  );

  const pieData = useMemo(() => {
    const totalTasks = filteredStats.reduce(
      (sum, s) => sum + s.tasksCompleted,
      0
    );
    const avgSuccess =
      totalTasks > 0
        ? filteredStats.reduce(
            (sum, s) => sum + s.successRate * s.tasksCompleted,
            0
          ) / totalTasks
        : 0;
    const successCount = Math.round((avgSuccess / 100) * totalTasks);
    const failCount = totalTasks - successCount;
    return [
      { name: "Success", value: successCount },
      { name: "Failure", value: failCount },
    ];
  }, [filteredStats]);

  const comparisonData = useMemo(() => {
    if (!(compareA && compareB)) {
      return null;
    }
    const a = stats.find((s) => s.role === compareA);
    const b = stats.find((s) => s.role === compareB);
    if (!(a && b)) {
      return null;
    }
    return { a, b };
  }, [stats, compareA, compareB]);

  if (stats.length === 0) {
    return (
      <Card className="border-zinc-800 bg-zinc-950">
        <CardContent className="flex h-64 items-center justify-center">
          <span className="text-sm text-zinc-600">
            No agent performance data available
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm text-zinc-200">
            Agent Performance
          </h3>
          <Badge className="bg-zinc-800 text-zinc-500" variant="secondary">
            {stats.length} agents
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {/* Date range */}
          <select
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-violet-500"
            onChange={(e) => handleRangeChange(e.target.value)}
            value={selectedRange}
          >
            {dateRanges.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>

          {/* Role filter */}
          <select
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-violet-500"
            onChange={(e) => handleRoleFilter(e.target.value)}
            value={roleFilter}
          >
            <option value="">All roles</option>
            {availableRoles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>

          {/* View toggle */}
          <div className="flex items-center gap-0.5 rounded border border-zinc-800 p-0.5">
            <button
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                viewMode === "chart"
                  ? "bg-violet-500/20 text-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              onClick={() => setViewMode("chart")}
              type="button"
            >
              Chart
            </button>
            <button
              className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                viewMode === "table"
                  ? "bg-violet-500/20 text-violet-400"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              onClick={() => setViewMode("table")}
              type="button"
            >
              Table
            </button>
          </div>
        </div>
      </div>

      <CardContent className="flex-1 overflow-auto p-4">
        {viewMode === "chart" ? (
          <div className="space-y-6">
            {/* Bar chart */}
            <div>
              <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                Agent Comparison
              </h4>
              <div className="h-64 w-full">
                <ResponsiveContainer height="100%" width="100%">
                  <BarChart data={barData}>
                    <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="name"
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
                      labelStyle={{ color: "#a1a1aa" }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: "10px", color: "#71717a" }}
                    />
                    <Bar
                      dataKey="Tasks Completed"
                      fill="#8b5cf6"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="Success Rate"
                      fill="#22c55e"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Trend line */}
            {trend.length > 0 && (
              <div>
                <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                  Trend Over Time
                </h4>
                <div className="h-48 w-full">
                  <ResponsiveContainer height="100%" width="100%">
                    <LineChart data={trend}>
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
                      />
                      <Line
                        dataKey="successRate"
                        dot={false}
                        name="Success Rate (%)"
                        stroke="#8b5cf6"
                        strokeWidth={2}
                        type="monotone"
                      />
                      <Line
                        dataKey="tasksCompleted"
                        dot={false}
                        name="Tasks Completed"
                        stroke="#22c55e"
                        strokeWidth={2}
                        type="monotone"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Token usage over time */}
            {trend.length > 0 &&
              trend.some((t) => t.tokensUsed !== undefined) && (
                <div>
                  <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                    Token Usage Over Time
                  </h4>
                  <div className="h-48 w-full">
                    <ResponsiveContainer height="100%" width="100%">
                      <LineChart data={trend}>
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
                        />
                        <Line
                          dataKey="tokensUsed"
                          dot={false}
                          name="Tokens Used"
                          stroke="#f59e0b"
                          strokeWidth={2}
                          type="monotone"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

            {/* Cost per task trend */}
            {trend.length > 0 && trend.some((t) => t.costUsd !== undefined) && (
              <div>
                <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                  Cost Per Task Trend
                </h4>
                <div className="h-48 w-full">
                  <ResponsiveContainer height="100%" width="100%">
                    <LineChart data={trend}>
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
                      />
                      <Line
                        dataKey="costUsd"
                        dot={false}
                        name="Cost (USD)"
                        stroke="#f43f5e"
                        strokeWidth={2}
                        type="monotone"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Success/Failure ratio pie chart */}
            <div className="flex gap-6">
              <div className="flex-1">
                <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                  Success / Failure Ratio
                </h4>
                <div className="h-48 w-full">
                  <ResponsiveContainer height="100%" width="100%">
                    <PieChart>
                      <Pie
                        cx="50%"
                        cy="50%"
                        data={pieData}
                        dataKey="value"
                        innerRadius={40}
                        nameKey="name"
                        outerRadius={70}
                      >
                        {pieData.map((_entry, index) => (
                          <Cell
                            fill={PIE_COLORS[index % PIE_COLORS.length]}
                            key={`cell-${String(index)}`}
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
                      />
                      <Legend
                        wrapperStyle={{ fontSize: "10px", color: "#71717a" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Comparison mode */}
              <div className="flex-1">
                <h4 className="mb-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                  Compare Agents
                </h4>
                <div className="mb-2 flex gap-2">
                  <select
                    className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-violet-500"
                    onChange={(e) => {
                      setCompareA(e.target.value);
                      if (e.target.value && compareB) {
                        onCompareChange?.([e.target.value, compareB]);
                      }
                    }}
                    value={compareA}
                  >
                    <option value="">Agent A</option>
                    {availableRoles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <span className="self-center text-[10px] text-zinc-600">
                    vs
                  </span>
                  <select
                    className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-violet-500"
                    onChange={(e) => {
                      setCompareB(e.target.value);
                      if (compareA && e.target.value) {
                        onCompareChange?.([compareA, e.target.value]);
                      }
                    }}
                    value={compareB}
                  >
                    <option value="">Agent B</option>
                    {availableRoles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>
                {comparisonData ? (
                  <div className="space-y-1 text-xs">
                    {(
                      [
                        ["Tasks", "tasksCompleted", ""],
                        ["Success", "successRate", "%"],
                        ["Avg Time", "avgTimeSec", "s"],
                        ["Tokens", "tokensUsed", ""],
                        ["Cost", "costUsd", " USD"],
                      ] as const
                    ).map(([label, key, unit]) => (
                      <div
                        className="flex items-center justify-between rounded bg-zinc-900/50 px-2 py-1"
                        key={key}
                      >
                        <span className="text-zinc-500">{label}</span>
                        <div className="flex gap-4">
                          <span className="font-mono text-violet-400">
                            {typeof comparisonData.a[key] === "number"
                              ? (comparisonData.a[key] as number).toFixed(1)
                              : comparisonData.a[key]}
                            {unit}
                          </span>
                          <span className="font-mono text-cyan-400">
                            {typeof comparisonData.b[key] === "number"
                              ? (comparisonData.b[key] as number).toFixed(1)
                              : comparisonData.b[key]}
                            {unit}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-24 items-center justify-center text-[10px] text-zinc-600">
                    Select two agents to compare
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Table view */
          <div className="overflow-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-zinc-800 border-b">
                  <th className="px-3 py-2">
                    <SortHeader
                      field="role"
                      onSort={handleSort}
                      sortDirection={sortDirection}
                      sortField={sortField}
                    >
                      Agent
                    </SortHeader>
                  </th>
                  <th className="px-3 py-2">
                    <SortHeader
                      field="tasksCompleted"
                      onSort={handleSort}
                      sortDirection={sortDirection}
                      sortField={sortField}
                    >
                      Tasks
                    </SortHeader>
                  </th>
                  <th className="px-3 py-2">
                    <SortHeader
                      field="successRate"
                      onSort={handleSort}
                      sortDirection={sortDirection}
                      sortField={sortField}
                    >
                      Success
                    </SortHeader>
                  </th>
                  <th className="px-3 py-2">
                    <SortHeader
                      field="avgTimeSec"
                      onSort={handleSort}
                      sortDirection={sortDirection}
                      sortField={sortField}
                    >
                      Avg Time
                    </SortHeader>
                  </th>
                  <th className="px-3 py-2">
                    <SortHeader
                      field="tokensUsed"
                      onSort={handleSort}
                      sortDirection={sortDirection}
                      sortField={sortField}
                    >
                      Tokens
                    </SortHeader>
                  </th>
                  <th className="px-3 py-2">
                    <SortHeader
                      field="costUsd"
                      onSort={handleSort}
                      sortDirection={sortDirection}
                      sortField={sortField}
                    >
                      Cost
                    </SortHeader>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredStats.map((stat) => (
                  <tr
                    className="border-zinc-800/50 border-b transition-colors hover:bg-zinc-900/50"
                    key={stat.role}
                  >
                    <td className="px-3 py-2">
                      <span className="font-medium text-zinc-300">
                        {stat.role}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-zinc-400">
                      {stat.tasksCompleted}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`font-mono ${successRateColor(stat.successRate)}`}
                      >
                        {stat.successRate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-zinc-400">
                      {formatDuration(stat.avgTimeSec)}
                    </td>
                    <td className="px-3 py-2 font-mono text-zinc-400">
                      {formatTokens(stat.tokensUsed)}
                    </td>
                    <td className="px-3 py-2 font-mono text-zinc-400">
                      {formatCost(stat.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
