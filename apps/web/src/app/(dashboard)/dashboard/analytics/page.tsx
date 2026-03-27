"use client";

function getRateVariant(rate: number) {
  if (rate >= 95) {
    return "default" as const;
  }
  if (rate >= 90) {
    return "secondary" as const;
  }
  return "outline" as const;
}

function _getStatusVariant(status: string) {
  if (status === "up") {
    return "default" as const;
  }
  if (status === "degraded") {
    return "secondary" as const;
  }
  return "destructive" as const;
}

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
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
import {
  Activity,
  BarChart3,
  Brain,
  Bug,
  CheckCircle,
  Clock,
  Cpu,
  DollarSign,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useState } from "react";

interface StatCard {
  change: string;
  color: string;
  icon: typeof Activity;
  title: string;
  trend: "up" | "down" | "neutral";
  value: string;
}

const OVERVIEW_STATS: StatCard[] = [
  {
    title: "Active Sessions",
    value: "23",
    change: "+12% from last week",
    trend: "up",
    icon: Activity,
    color: "text-blue-500",
  },
  {
    title: "Tasks Today",
    value: "147",
    change: "+8% from yesterday",
    trend: "up",
    icon: Zap,
    color: "text-amber-500",
  },
  {
    title: "Success Rate",
    value: "94.8%",
    change: "+2.1% from last week",
    trend: "up",
    icon: CheckCircle,
    color: "text-green-500",
  },
  {
    title: "Avg Duration",
    value: "4m 32s",
    change: "-18s from last week",
    trend: "up",
    icon: Clock,
    color: "text-purple-500",
  },
];

interface CostEntry {
  cost: number;
  name: string;
  percentage: number;
  requests: number;
  tokens: number;
}

const COST_BY_MODEL: CostEntry[] = [
  {
    name: "Claude Sonnet 4",
    cost: 342.18,
    tokens: 28_540_000,
    requests: 4280,
    percentage: 45.2,
  },
  {
    name: "GPT-4o",
    cost: 198.45,
    tokens: 16_120_000,
    requests: 2890,
    percentage: 26.2,
  },
  {
    name: "Claude 3.5 Haiku",
    cost: 87.32,
    tokens: 42_800_000,
    requests: 8100,
    percentage: 11.5,
  },
  {
    name: "GPT-4o Mini",
    cost: 64.9,
    tokens: 38_200_000,
    requests: 6420,
    percentage: 8.6,
  },
  {
    name: "Gemini 2.0 Flash",
    cost: 42.15,
    tokens: 22_300_000,
    requests: 3750,
    percentage: 5.6,
  },
  {
    name: "Others",
    cost: 22.0,
    tokens: 8_100_000,
    requests: 1200,
    percentage: 2.9,
  },
];

const COST_BY_PROJECT: CostEntry[] = [
  {
    name: "prometheus-web",
    cost: 284.5,
    tokens: 23_700_000,
    requests: 8400,
    percentage: 37.6,
  },
  {
    name: "prometheus-api",
    cost: 198.2,
    tokens: 16_500_000,
    requests: 5900,
    percentage: 26.2,
  },
  {
    name: "mobile-app",
    cost: 124.8,
    tokens: 10_400_000,
    requests: 3700,
    percentage: 16.5,
  },
  {
    name: "data-pipeline",
    cost: 89.3,
    tokens: 7_440_000,
    requests: 2650,
    percentage: 11.8,
  },
  {
    name: "docs-site",
    cost: 60.2,
    tokens: 5_020_000,
    requests: 1790,
    percentage: 7.9,
  },
];

const DAILY_COSTS = [
  { date: "Mar 20", cost: 98.42 },
  { date: "Mar 21", cost: 112.35 },
  { date: "Mar 22", cost: 89.18 },
  { date: "Mar 23", cost: 134.67 },
  { date: "Mar 24", cost: 121.9 },
  { date: "Mar 25", cost: 108.54 },
  { date: "Mar 26", cost: 91.94 },
];

interface ModelUsage {
  avgLatency: string;
  errorRate: string;
  inputTokens: number;
  model: string;
  outputTokens: number;
  requests: number;
  totalTokens: number;
}

const MODEL_USAGE: ModelUsage[] = [
  {
    model: "Claude Sonnet 4",
    inputTokens: 18_240_000,
    outputTokens: 10_300_000,
    totalTokens: 28_540_000,
    requests: 4280,
    avgLatency: "1.8s",
    errorRate: "0.3%",
  },
  {
    model: "GPT-4o",
    inputTokens: 10_480_000,
    outputTokens: 5_640_000,
    totalTokens: 16_120_000,
    requests: 2890,
    avgLatency: "2.1s",
    errorRate: "0.5%",
  },
  {
    model: "Claude 3.5 Haiku",
    inputTokens: 28_200_000,
    outputTokens: 14_600_000,
    totalTokens: 42_800_000,
    requests: 8100,
    avgLatency: "0.6s",
    errorRate: "0.2%",
  },
  {
    model: "GPT-4o Mini",
    inputTokens: 24_800_000,
    outputTokens: 13_400_000,
    totalTokens: 38_200_000,
    requests: 6420,
    avgLatency: "0.4s",
    errorRate: "0.1%",
  },
  {
    model: "Gemini 2.0 Flash",
    inputTokens: 14_200_000,
    outputTokens: 8_100_000,
    totalTokens: 22_300_000,
    requests: 3750,
    avgLatency: "0.7s",
    errorRate: "0.4%",
  },
];

interface QualityMetric {
  change: string;
  description: string;
  label: string;
  trend: "up" | "down";
  value: string;
}

const QUALITY_METRICS: QualityMetric[] = [
  {
    label: "Bug Fix Rate",
    value: "92.3%",
    description: "Percentage of bugs successfully resolved on first attempt",
    trend: "up",
    change: "+3.1%",
  },
  {
    label: "Code Review Approval",
    value: "87.6%",
    description: "PRs approved without changes requested",
    trend: "up",
    change: "+1.8%",
  },
  {
    label: "Test Coverage Improvement",
    value: "+4.2%",
    description: "Average coverage increase per task",
    trend: "up",
    change: "+0.5%",
  },
  {
    label: "First-Time Resolution",
    value: "78.4%",
    description: "Tasks completed correctly without rework",
    trend: "up",
    change: "+2.7%",
  },
  {
    label: "Mean Time to Resolution",
    value: "6m 14s",
    description: "Average time from task start to completion",
    trend: "up",
    change: "-42s",
  },
  {
    label: "Code Churn Rate",
    value: "8.2%",
    description: "Percentage of code rewritten within 48 hours",
    trend: "down",
    change: "-1.4%",
  },
];

const QUALITY_BREAKDOWN = [
  {
    category: "Feature Implementation",
    successRate: "96.1%",
    count: 312,
    avgDuration: "5m 42s",
  },
  {
    category: "Bug Fixes",
    successRate: "92.3%",
    count: 287,
    avgDuration: "3m 18s",
  },
  {
    category: "Refactoring",
    successRate: "98.7%",
    count: 156,
    avgDuration: "4m 05s",
  },
  {
    category: "Test Writing",
    successRate: "94.5%",
    count: 198,
    avgDuration: "2m 54s",
  },
  {
    category: "Documentation",
    successRate: "99.2%",
    count: 89,
    avgDuration: "1m 47s",
  },
  {
    category: "Code Review",
    successRate: "87.6%",
    count: 245,
    avgDuration: "7m 31s",
  },
];

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1000) {
    return `${(n / 1000).toFixed(0)}K`;
  }
  return String(n);
}

export default function AnalyticsDashboardPage() {
  const [activeTab, setActiveTab] = useState("overview");

  const totalCost = COST_BY_MODEL.reduce((acc, m) => acc + m.cost, 0);
  const totalTokens = MODEL_USAGE.reduce((acc, m) => acc + m.totalTokens, 0);
  const totalRequests = MODEL_USAGE.reduce((acc, m) => acc + m.requests, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl text-foreground">Analytics</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Insights into usage, costs, model performance, and code quality.
        </p>
      </div>

      <Tabs onValueChange={setActiveTab} value={activeTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="costs">Costs</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="quality">Quality</TabsTrigger>
        </TabsList>

        <TabsContent className="space-y-6 pt-4" value="overview">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {OVERVIEW_STATS.map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.title}>
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <p className="text-muted-foreground text-sm">
                        {stat.title}
                      </p>
                      <Icon className={`h-5 w-5 ${stat.color}`} />
                    </div>
                    <p className="mt-2 font-bold text-3xl text-foreground">
                      {stat.value}
                    </p>
                    <div className="mt-1 flex items-center gap-1">
                      {stat.trend === "up" ? (
                        <TrendingUp className="h-3 w-3 text-green-500" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-red-500" />
                      )}
                      <p className="text-muted-foreground text-xs">
                        {stat.change}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Tasks by Category (This Week)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {QUALITY_BREAKDOWN.map((item) => (
                    <div
                      className="flex items-center gap-3"
                      key={item.category}
                    >
                      <div className="w-36 shrink-0 text-sm">
                        {item.category}
                      </div>
                      <div className="h-2 flex-1 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{
                            width: `${(item.count / 312) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-10 text-right font-medium text-sm">
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Daily Cost Trend (Last 7 Days)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {DAILY_COSTS.map((day) => (
                    <div className="flex items-center gap-3" key={day.date}>
                      <span className="w-16 shrink-0 text-muted-foreground text-sm">
                        {day.date}
                      </span>
                      <div className="h-3 flex-1 rounded-full bg-muted">
                        <div
                          className="h-3 rounded-full bg-green-500/70"
                          style={{
                            width: `${(day.cost / 140) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="w-16 text-right font-mono text-sm">
                        ${day.cost.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                <Separator className="my-4" />
                <div className="flex justify-between">
                  <span className="text-muted-foreground text-sm">
                    7-day total
                  </span>
                  <span className="font-semibold text-foreground">
                    ${DAILY_COSTS.reduce((a, d) => a + d.cost, 0).toFixed(2)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent className="space-y-6 pt-4" value="costs">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-green-500" />
                  <p className="text-muted-foreground text-sm">
                    Total Spend (30d)
                  </p>
                </div>
                <p className="mt-2 font-bold text-3xl text-foreground">
                  ${totalCost.toFixed(2)}
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  -6.2% from last month
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-blue-500" />
                  <p className="text-muted-foreground text-sm">
                    Total Tokens (30d)
                  </p>
                </div>
                <p className="mt-2 font-bold text-3xl text-foreground">
                  {formatTokens(totalTokens)}
                </p>
                <p className="mt-1 text-muted-foreground text-xs">
                  +11.3% from last month
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-purple-500" />
                  <p className="text-muted-foreground text-sm">Cost per Task</p>
                </div>
                <p className="mt-2 font-bold text-3xl text-foreground">$0.58</p>
                <p className="mt-1 text-muted-foreground text-xs">
                  -12.1% from last month
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cost by Model</CardTitle>
                <CardDescription>
                  Breakdown of spend across AI models
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Model</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Tokens</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {COST_BY_MODEL.map((entry) => (
                      <TableRow key={entry.name}>
                        <TableCell className="font-medium">
                          {entry.name}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${entry.cost.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {formatTokens(entry.tokens)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline">{entry.percentage}%</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cost by Project</CardTitle>
                <CardDescription>
                  Breakdown of spend across projects
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Requests</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {COST_BY_PROJECT.map((entry) => (
                      <TableRow key={entry.name}>
                        <TableCell className="font-medium font-mono text-sm">
                          {entry.name}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          ${entry.cost.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {entry.requests.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant="outline">{entry.percentage}%</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily Cost Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {DAILY_COSTS.map((day) => (
                  <div className="flex items-center gap-3" key={day.date}>
                    <span className="w-16 shrink-0 text-muted-foreground text-sm">
                      {day.date}
                    </span>
                    <div className="h-4 flex-1 rounded bg-muted">
                      <div
                        className="h-4 rounded bg-primary/70"
                        style={{ width: `${(day.cost / 140) * 100}%` }}
                      />
                    </div>
                    <span className="w-20 text-right font-mono text-sm">
                      ${day.cost.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent className="space-y-6 pt-4" value="models">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-sm">Total Tokens</p>
                <p className="mt-1 font-bold text-3xl text-foreground">
                  {formatTokens(totalTokens)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-sm">Total Requests</p>
                <p className="mt-1 font-bold text-3xl text-foreground">
                  {totalRequests.toLocaleString()}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-sm">Active Models</p>
                <p className="mt-1 font-bold text-3xl text-foreground">
                  {MODEL_USAGE.length}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Model Performance and Usage
              </CardTitle>
              <CardDescription>
                Token usage, latency, and error rates per model
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Input Tokens</TableHead>
                    <TableHead className="text-right">Output Tokens</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="text-right">Avg Latency</TableHead>
                    <TableHead className="text-right">Error Rate</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {MODEL_USAGE.map((model) => (
                    <TableRow key={model.model}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Brain className="h-4 w-4 text-muted-foreground" />
                          {model.model}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatTokens(model.inputTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatTokens(model.outputTokens)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatTokens(model.totalTokens)}
                      </TableCell>
                      <TableCell className="text-right">
                        {model.requests.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {model.avgLatency}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={
                            Number.parseFloat(model.errorRate) > 0.3
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {model.errorRate}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Token Distribution by Model
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {MODEL_USAGE.map((model) => (
                    <div className="space-y-1" key={model.model}>
                      <div className="flex justify-between text-sm">
                        <span>{model.model}</span>
                        <span className="font-mono text-muted-foreground">
                          {formatTokens(model.totalTokens)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-primary"
                          style={{
                            width: `${(model.totalTokens / totalTokens) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Requests per Model</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {MODEL_USAGE.map((model) => (
                    <div className="space-y-1" key={model.model}>
                      <div className="flex justify-between text-sm">
                        <span>{model.model}</span>
                        <span className="font-mono text-muted-foreground">
                          {model.requests.toLocaleString()}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-blue-500"
                          style={{
                            width: `${(model.requests / totalRequests) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent className="space-y-6 pt-4" value="quality">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {QUALITY_METRICS.map((metric) => (
              <Card key={metric.label}>
                <CardContent className="pt-6">
                  <p className="text-muted-foreground text-sm">
                    {metric.label}
                  </p>
                  <p className="mt-1 font-bold text-2xl text-foreground">
                    {metric.value}
                  </p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {metric.description}
                  </p>
                  <div className="mt-2 flex items-center gap-1">
                    {metric.trend === "up" ? (
                      <TrendingUp className="h-3 w-3 text-green-500" />
                    ) : (
                      <TrendingDown className="h-3 w-3 text-amber-500" />
                    )}
                    <span className="text-green-500 text-xs">
                      {metric.change} from last month
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Quality by Task Category
              </CardTitle>
              <CardDescription>
                Success rate and performance across different task types
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Success Rate</TableHead>
                    <TableHead className="text-right">Tasks</TableHead>
                    <TableHead className="text-right">Avg Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {QUALITY_BREAKDOWN.map((item) => (
                    <TableRow key={item.category}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Bug className="h-4 w-4 text-muted-foreground" />
                          {item.category}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={getRateVariant(
                            Number.parseFloat(item.successRate)
                          )}
                        >
                          {item.successRate}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{item.count}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {item.avgDuration}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
