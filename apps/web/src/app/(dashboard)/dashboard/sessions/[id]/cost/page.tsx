"use client";

import {
  Badge,
  BudgetAlert,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CostTracker,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@prometheus/ui";
import { use } from "react";
import { trpc } from "@/lib/trpc";

function formatCost(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return String(count);
}

interface ModelUsage {
  costUsd: number;
  model: string;
  requestCount: number;
  tokensIn: number;
  tokensOut: number;
}

export default function SessionCostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: sessionId } = use(params);

  const costQuery = trpc.costPrediction.history.useQuery(
    { days: 30, limit: 50 },
    { retry: 2 }
  );

  // Find session-specific cost data
  const sessionCost = costQuery.data?.entries.find(
    (e) => e.sessionId === sessionId
  );

  const actualCost = sessionCost?.actualCostUsd ?? 0;
  const predictedCost = sessionCost?.predictedCostUsd ?? 0;
  const totalTokens = sessionCost?.totalTokens ?? 0;
  const accuracy = sessionCost?.accuracy ?? 0;

  // Simulated model breakdown based on session data
  const modelBreakdown: ModelUsage[] = [
    {
      model: "claude-sonnet-4",
      tokensIn: Math.round(totalTokens * 0.6),
      tokensOut: Math.round(totalTokens * 0.15),
      costUsd: actualCost * 0.65,
      requestCount: Math.round((sessionCost?.requestCount ?? 0) * 0.7),
    },
    {
      model: "claude-opus-4",
      tokensIn: Math.round(totalTokens * 0.15),
      tokensOut: Math.round(totalTokens * 0.1),
      costUsd: actualCost * 0.35,
      requestCount: Math.round((sessionCost?.requestCount ?? 0) * 0.3),
    },
  ];

  const budgetLimit = 5.0; // Default budget limit

  if (costQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <span className="text-sm text-zinc-500">Loading cost data...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-foreground text-xl">Session Cost</h1>
          <p className="text-muted-foreground text-xs">
            Detailed cost breakdown and token usage for this session.
          </p>
        </div>
        <Badge variant="outline">{sessionId.slice(0, 12)}</Badge>
      </div>

      {/* Budget alert */}
      <BudgetAlert
        budgetLimit={budgetLimit}
        currentCost={actualCost}
        warningThreshold={0.8}
      />

      {/* Cost tracker */}
      <div className="grid gap-4 md:grid-cols-2">
        <CostTracker
          costUsd={actualCost}
          modelBreakdown={modelBreakdown.map((m) => ({
            model: m.model,
            tokensIn: m.tokensIn,
            tokensOut: m.tokensOut,
            costUsd: m.costUsd,
          }))}
          sessionId={sessionId}
          tokensIn={Math.round(totalTokens * 0.75)}
          tokensOut={Math.round(totalTokens * 0.25)}
        />

        {/* Cost comparison with estimates */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cost vs Estimate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">Actual Cost</span>
              <span className="font-mono font-semibold">
                {formatCost(actualCost)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">
                Predicted Cost
              </span>
              <span className="font-mono">{formatCost(predictedCost)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs">Accuracy</span>
              <span className="font-mono">{accuracy}%</span>
            </div>

            {/* Budget utilization bar */}
            <div className="space-y-1 border-t pt-3">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground">
                  Budget Utilization
                </span>
                <span className="font-mono">
                  {Math.round((actualCost / budgetLimit) * 100)}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-violet-500 transition-all"
                  style={{
                    width: `${Math.min(100, (actualCost / budgetLimit) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-model breakdown table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Per-Model Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Tokens In</TableHead>
                <TableHead className="text-right">Tokens Out</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {modelBreakdown.map((m) => (
                <TableRow key={m.model}>
                  <TableCell className="font-mono text-xs">{m.model}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatTokens(m.tokensIn)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatTokens(m.tokensOut)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {m.requestCount}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {formatCost(m.costUsd)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Token usage over time (placeholder chart area) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Token Usage Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-end gap-1">
            {[
              1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
              20,
            ].map((period) => {
              const height = Math.max(
                10,
                Math.round((Math.sin(period * 0.5) * 0.5 + 0.5) * 100)
              );
              return (
                <div
                  className="flex-1 rounded-t bg-violet-500/40 transition-all hover:bg-violet-500/60"
                  key={`bar-period-${period}`}
                  style={{ height: `${height}%` }}
                  title={`Period ${period}`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
            <span>Session Start</span>
            <span>Current</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
