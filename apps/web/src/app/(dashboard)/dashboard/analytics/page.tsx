"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@prometheus/ui";
import { CheckCircle, Coins, Target, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const CHART_COLORS = ["#a78bfa", "#22d3ee", "#fb923c", "#4ade80", "#f472b6"];

interface TaskDataPoint {
  completed: number;
  credits: number;
  date: string;
  failed: number;
}

function TaskHistoryTable({ taskMetrics }: { taskMetrics: TaskDataPoint[] }) {
  if (taskMetrics.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-zinc-500">
        No task data yet. Complete tasks to see metrics here.
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead className="text-right">Completed</TableHead>
          <TableHead className="text-right">Failed</TableHead>
          <TableHead className="text-right">Credits</TableHead>
          <TableHead>Success</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {taskMetrics.map((dp) => {
          const total = dp.completed + dp.failed;
          const rate =
            total > 0 ? ((dp.completed / total) * 100).toFixed(0) : "--";
          return (
            <TableRow key={dp.date}>
              <TableCell className="font-mono text-xs text-zinc-300">
                {new Date(dp.date).toLocaleDateString()}
              </TableCell>
              <TableCell className="text-right text-green-400">
                {dp.completed}
              </TableCell>
              <TableCell className="text-right text-red-400">
                {dp.failed}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-zinc-400">
                {dp.credits}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-zinc-800">
                    <div
                      className="h-1.5 rounded-full bg-green-500"
                      style={{
                        width: `${total > 0 ? (dp.completed / total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs text-zinc-500">
                    {rate}%
                  </span>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ModelUsageTable({
  modelUsage,
  totalModelTokens,
}: {
  modelUsage: Array<{
    cost: number;
    model: string;
    requests: number;
    tokens: number;
  }>;
  totalModelTokens: number;
}) {
  if (modelUsage.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-zinc-500">
        No model usage data yet.
      </div>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Model</TableHead>
          <TableHead className="text-right">Requests</TableHead>
          <TableHead className="text-right">Tokens</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead>Share</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {modelUsage.map((model) => {
          const share =
            totalModelTokens > 0 ? (model.tokens / totalModelTokens) * 100 : 0;
          return (
            <TableRow key={model.model}>
              <TableCell>
                <span className="font-mono text-xs text-zinc-300">
                  {model.model}
                </span>
              </TableCell>
              <TableCell className="text-right text-zinc-400">
                {model.requests.toLocaleString()}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-zinc-400">
                {model.tokens.toLocaleString()}
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-zinc-400">
                ${model.cost.toFixed(4)}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-zinc-800">
                    <div
                      className="h-1.5 rounded-full bg-violet-500"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                  <span className="w-10 text-right text-xs text-zinc-500">
                    {share.toFixed(1)}%
                  </span>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);

  const overviewQuery = trpc.stats.overview.useQuery({ days }, { retry: 2 });
  const taskMetricsQuery = trpc.stats.taskMetrics.useQuery(
    { days, groupBy: "day" },
    { retry: 2 }
  );
  const modelUsageQuery = trpc.stats.modelUsage.useQuery(
    { days },
    { retry: 2 }
  );
  const roiQuery = trpc.stats.roi.useQuery(undefined, { retry: 2 });

  const overview = overviewQuery.data;
  const taskMetrics = taskMetricsQuery.data?.dataPoints ?? [];
  const modelUsage = modelUsageQuery.data?.byModel ?? [];
  const roi = roiQuery.data;

  const totalModelTokens = useMemo(
    () => modelUsage.reduce((s, m) => s + m.tokens, 0),
    [modelUsage]
  );

  const totalModelCost = useMemo(
    () => modelUsage.reduce((s, m) => s + m.cost, 0),
    [modelUsage]
  );

  const costPieData = useMemo(
    () =>
      modelUsage.map((m, i) => ({
        name: m.model,
        value: m.cost,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      })),
    [modelUsage]
  );

  const isLoading =
    overviewQuery.isLoading ||
    taskMetricsQuery.isLoading ||
    modelUsageQuery.isLoading ||
    roiQuery.isLoading;

  const handleExport = () => {
    const rows = [
      ["Date", "Completed", "Failed", "Credits"],
      ...taskMetrics.map((dp) => [
        dp.date,
        dp.completed,
        dp.failed,
        dp.credits,
      ]),
    ];
    const csvContent = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `prometheus-analytics-${days}d.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Analytics data exported");
  };

  function getSuccessRateValue(): string | number {
    if (isLoading) {
      return "--";
    }
    if (overview?.successRate) {
      return `${(overview.successRate * 100).toFixed(1)}%`;
    }
    return "--";
  }

  function getRoiValue(): string | number {
    if (isLoading) {
      return "--";
    }
    if (roi?.roiMultiplier) {
      return `${roi.roiMultiplier}x`;
    }
    return "--";
  }

  function getRoiSubtitle(): string {
    if (isLoading) {
      return "Loading...";
    }
    if (roi?.estimatedHoursSaved) {
      return `${roi.estimatedHoursSaved}h saved`;
    }
    return "No data yet";
  }

  const statCards = [
    {
      label: "Tasks Completed",
      value: isLoading ? "--" : (overview?.tasksCompleted ?? 0),
      subtitle: `in the last ${days} days`,
      icon: CheckCircle,
      iconColor: "text-blue-500",
      iconBg: "bg-blue-500/10",
    },
    {
      label: "Credits Used",
      value: isLoading
        ? "--"
        : (overview?.creditsUsed?.toLocaleString() ?? "0"),
      subtitle: `in the last ${days} days`,
      icon: Coins,
      iconColor: "text-yellow-500",
      iconBg: "bg-yellow-500/10",
    },
    {
      label: "Success Rate",
      value: getSuccessRateValue(),
      subtitle: "task completion rate",
      icon: Target,
      iconColor: "text-green-500",
      iconBg: "bg-green-500/10",
    },
    {
      label: "ROI",
      value: getRoiValue(),
      subtitle: getRoiSubtitle(),
      icon: TrendingUp,
      iconColor: "text-violet-500",
      iconBg: "bg-violet-500/10",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-zinc-100">Analytics</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Track your usage, costs, and productivity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map((d) => (
            <Button
              className={
                days === d ? "bg-violet-600 text-white hover:bg-violet-700" : ""
              }
              key={d}
              onClick={() => setDays(d)}
              size="sm"
              variant={days === d ? "default" : "outline"}
            >
              {d}d
            </Button>
          ))}
          <Button onClick={handleExport} size="sm" variant="ghost">
            Export
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-5">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${stat.iconBg}`}
                >
                  <stat.icon
                    aria-hidden="true"
                    className={`h-4 w-4 ${stat.iconColor}`}
                  />
                </div>
                <span className="font-medium text-xs text-zinc-500">
                  {stat.label}
                </span>
              </div>
              <div className="mt-3 font-bold text-3xl text-zinc-100">
                {stat.value}
              </div>
              <div className="mt-1 text-xs text-zinc-500">{stat.subtitle}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ROI Summary Card */}
      {roi && (roi.estimatedValueUsd > 0 || roi.estimatedHoursSaved > 0) && (
        <Card className="border-violet-800/30 bg-violet-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="font-semibold text-sm text-violet-300">
              Return on Investment
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-4">
              <div>
                <div className="text-xs text-zinc-500">Hours Saved</div>
                <div className="mt-1 font-bold text-2xl text-zinc-100 tabular-nums transition-all duration-500">
                  {roi.estimatedHoursSaved}h
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Estimated Value</div>
                <div className="mt-1 font-bold text-2xl text-green-400 tabular-nums transition-all duration-500">
                  ${roi.estimatedValueUsd.toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Credits Cost</div>
                <div className="mt-1 font-bold text-2xl text-zinc-100 tabular-nums transition-all duration-500">
                  {roi.creditsCost}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">ROI Multiplier</div>
                <div className="mt-1 font-bold text-2xl text-violet-400 tabular-nums transition-all duration-500">
                  {roi.roiMultiplier}x
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <Tabs defaultValue="trends">
        <TabsList>
          <TabsTrigger value="trends">Task Trends</TabsTrigger>
          <TabsTrigger value="models">Model Usage</TabsTrigger>
          <TabsTrigger value="costs">Cost Distribution</TabsTrigger>
        </TabsList>

        {/* Area Chart - Task Completion Trends */}
        <TabsContent value="trends">
          <Card>
            <CardHeader>
              <CardTitle>Task Completion Trends</CardTitle>
            </CardHeader>
            <CardContent>
              {taskMetrics.length === 0 ? (
                <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
                  No task data yet. Complete tasks to see trends here.
                </div>
              ) : (
                <ResponsiveContainer height={320} width="100%">
                  <AreaChart data={taskMetrics}>
                    <defs>
                      <linearGradient
                        id="completedGradient"
                        x1="0"
                        x2="0"
                        y1="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#a78bfa"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="#a78bfa"
                          stopOpacity={0}
                        />
                      </linearGradient>
                      <linearGradient
                        id="failedGradient"
                        x1="0"
                        x2="0"
                        y1="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#fb923c"
                          stopOpacity={0.3}
                        />
                        <stop
                          offset="95%"
                          stopColor="#fb923c"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="#27272a"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      stroke="#71717a"
                      tick={{ fontSize: 12, fill: "#a1a1aa" }}
                      tickFormatter={(v: string) =>
                        new Date(v).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      }
                      tickLine={false}
                    />
                    <YAxis
                      allowDecimals={false}
                      stroke="#71717a"
                      tick={{ fontSize: 12, fill: "#a1a1aa" }}
                      tickLine={false}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: "#18181b",
                        border: "1px solid #3f3f46",
                        borderRadius: "8px",
                        fontSize: 12,
                      }}
                      labelFormatter={(v) =>
                        new Date(String(v)).toLocaleDateString()
                      }
                    />
                    <Area
                      dataKey="completed"
                      fill="url(#completedGradient)"
                      name="Completed"
                      stroke="#a78bfa"
                      strokeWidth={2}
                      type="monotone"
                    />
                    <Area
                      dataKey="failed"
                      fill="url(#failedGradient)"
                      name="Failed"
                      stroke="#fb923c"
                      strokeWidth={2}
                      type="monotone"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Bar Chart - Model Usage */}
        <TabsContent value="models">
          <Card>
            <CardHeader>
              <CardTitle>Model Usage Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {modelUsage.length === 0 ? (
                <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
                  No model usage data yet.
                </div>
              ) : (
                <ResponsiveContainer height={320} width="100%">
                  <BarChart
                    data={modelUsage}
                    layout="vertical"
                    margin={{ left: 80 }}
                  >
                    <CartesianGrid
                      horizontal={false}
                      stroke="#27272a"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      stroke="#71717a"
                      tick={{ fontSize: 12, fill: "#a1a1aa" }}
                      tickFormatter={(v: number) => v.toLocaleString()}
                      tickLine={false}
                      type="number"
                    />
                    <YAxis
                      dataKey="model"
                      stroke="#71717a"
                      tick={{ fontSize: 11, fill: "#a1a1aa" }}
                      tickLine={false}
                      type="category"
                      width={80}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: "#18181b",
                        border: "1px solid #3f3f46",
                        borderRadius: "8px",
                        fontSize: 12,
                      }}
                      formatter={(value) => [
                        Number(value).toLocaleString(),
                        "Requests",
                      ]}
                    />
                    <Bar
                      dataKey="requests"
                      name="Requests"
                      radius={[0, 4, 4, 0]}
                    >
                      {modelUsage.map((_entry, index) => (
                        <Cell
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                          key={`cell-${_entry.model}`}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pie Chart - Cost Distribution */}
        <TabsContent value="costs">
          <Card>
            <CardHeader>
              <CardTitle>Cost Distribution by Model</CardTitle>
            </CardHeader>
            <CardContent>
              {modelUsage.length === 0 ? (
                <div className="flex h-64 items-center justify-center text-sm text-zinc-500">
                  No cost data yet.
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 md:flex-row md:gap-8">
                  <ResponsiveContainer height={320} width="100%">
                    <PieChart>
                      <Pie
                        cx="50%"
                        cy="50%"
                        data={costPieData}
                        dataKey="value"
                        innerRadius={60}
                        nameKey="name"
                        outerRadius={120}
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {costPieData.map((entry) => (
                          <Cell fill={entry.fill} key={`pie-${entry.name}`} />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: "#18181b",
                          border: "1px solid #3f3f46",
                          borderRadius: "8px",
                          fontSize: 12,
                        }}
                        formatter={(value) => [
                          `$${Number(value).toFixed(4)}`,
                          "Cost",
                        ]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-col gap-3">
                    {costPieData.map((entry) => {
                      const pct =
                        totalModelCost > 0
                          ? ((entry.value / totalModelCost) * 100).toFixed(1)
                          : "0.0";
                      return (
                        <div
                          className="flex items-center gap-2"
                          key={entry.name}
                        >
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: entry.fill }}
                          />
                          <span className="font-mono text-xs text-zinc-300">
                            {entry.name}
                          </span>
                          <Badge variant="secondary">{pct}%</Badge>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Task History Table */}
      <Card>
        <CardHeader>
          <CardTitle>Task History</CardTitle>
        </CardHeader>
        <CardContent>
          <TaskHistoryTable taskMetrics={taskMetrics} />
        </CardContent>
      </Card>

      {/* Model Usage Table */}
      <Card>
        <CardHeader>
          <CardTitle>Model Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <ModelUsageTable
            modelUsage={modelUsage}
            totalModelTokens={totalModelTokens}
          />
        </CardContent>
      </Card>
    </div>
  );
}
