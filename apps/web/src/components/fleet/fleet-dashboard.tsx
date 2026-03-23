"use client";

import { Card, CardContent, Progress } from "@prometheus/ui";
import {
  AlertTriangle,
  CheckCircle,
  Coins,
  Cpu,
  Flame,
  Hash,
} from "lucide-react";
import { useFleetStore } from "@/stores/fleet.store";

function formatTokenCount(tokens: number): string {
  if (tokens > 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens > 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toLocaleString();
}

interface FleetDashboardProps {
  activeCount: number;
  burnRate: string;
  completedTasks: number;
  failedTasks: number;
  progressPct: number;
  totalAgents: number;
  totalCredits: number;
  totalTasks: number;
  totalTokens: number;
}

export function FleetDashboard({
  activeCount: propActiveCount,
  burnRate: propBurnRate,
  completedTasks,
  failedTasks,
  progressPct,
  totalAgents: propTotalAgents,
  totalCredits,
  totalTasks,
  totalTokens,
}: FleetDashboardProps) {
  // Wire to real-time data from fleet store (WebSocket-driven)
  const storeStats = useFleetStore((s) => s.stats);
  const storeAgents = useFleetStore((s) => s.agents);
  const storeBurnRate = useFleetStore((s) => s.creditBurnRate);

  // Prefer real-time store data when agents exist, fall back to props
  const hasRealtimeData = storeAgents.size > 0;
  const activeCount = hasRealtimeData ? storeStats.active : propActiveCount;
  const totalAgents = hasRealtimeData ? storeStats.total : propTotalAgents;
  const burnRate = hasRealtimeData
    ? storeBurnRate.ratePerMinute.toFixed(1)
    : propBurnRate;

  // Build live agent status indicators from store
  const agentStatuses = hasRealtimeData
    ? Array.from(storeAgents.values()).map((a) => ({
        id: a.id,
        role: a.role,
        status: a.status,
      }))
    : [];

  return (
    <div className="space-y-4">
      {/* Real-time metrics bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            {activeCount > 0 && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                activeCount > 0 ? "bg-green-500" : "bg-zinc-500"
              }`}
            />
          </span>
          <span className="font-medium text-sm text-zinc-300">
            {activeCount} active
          </span>
        </div>
        <div className="h-4 w-px bg-zinc-700" />
        <div className="flex items-center gap-1.5 text-sm text-zinc-400">
          <CheckCircle className="h-3.5 w-3.5 text-green-500" />
          {completedTasks} completed
        </div>
        <div className="flex items-center gap-1.5 text-sm text-zinc-400">
          <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
          {failedTasks} failed
        </div>
        <div className="h-4 w-px bg-zinc-700" />
        <div className="flex items-center gap-1.5 text-sm text-zinc-400">
          <Flame className="h-3.5 w-3.5 text-orange-500" />
          <span className="font-mono">{burnRate}</span> credits/min
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-zinc-500">Progress</span>
          <Progress className="h-2 w-32" value={progressPct} />
          <span className="font-mono text-xs text-zinc-400">
            {progressPct}%
          </span>
        </div>
      </div>

      {/* Live agent status indicators (from WebSocket) */}
      {agentStatuses.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800/50 bg-zinc-900/30 px-3 py-2">
          <span className="text-[10px] text-zinc-600 uppercase tracking-wider">
            Live Agents:
          </span>
          {agentStatuses.map((agent) => {
            let statusDot = "bg-blue-500";
            if (agent.status === "working") {
              statusDot = "animate-pulse bg-green-500";
            } else if (agent.status === "idle") {
              statusDot = "bg-zinc-500";
            } else if (agent.status === "failed") {
              statusDot = "bg-red-500";
            }

            return (
              <div
                className="flex items-center gap-1 rounded-full border border-zinc-800 px-2 py-0.5"
                key={agent.id}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
                <span className="text-[10px] text-zinc-400">{agent.role}</span>
                <span className="text-[9px] text-zinc-600">{agent.status}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-green-500/10">
                <Cpu className="h-3.5 w-3.5 text-green-500" />
              </div>
              <span className="font-medium text-muted-foreground text-xs">
                Agents
              </span>
            </div>
            <div className="mt-2 font-bold text-2xl text-foreground">
              {activeCount}
              <span className="font-normal text-muted-foreground text-sm">
                /{totalAgents}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10">
                <CheckCircle className="h-3.5 w-3.5 text-blue-500" />
              </div>
              <span className="font-medium text-muted-foreground text-xs">
                Tasks Done
              </span>
            </div>
            <div className="mt-2 font-bold text-2xl text-foreground">
              {completedTasks}
              <span className="font-normal text-muted-foreground text-sm">
                /{totalTasks}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-yellow-500/10">
                <Coins className="h-3.5 w-3.5 text-yellow-500" />
              </div>
              <span className="font-medium text-muted-foreground text-xs">
                Credits Used
              </span>
            </div>
            <div className="mt-2 font-bold text-2xl text-foreground">
              {totalCredits.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/10">
                <Hash className="h-3.5 w-3.5 text-violet-500" />
              </div>
              <span className="font-medium text-muted-foreground text-xs">
                Total Tokens
              </span>
            </div>
            <div className="mt-2 font-bold text-2xl text-foreground">
              {formatTokenCount(totalTokens)}
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-500/10">
                <Flame className="h-3.5 w-3.5 text-orange-500" />
              </div>
              <span className="font-medium text-muted-foreground text-xs">
                Burn Rate
              </span>
            </div>
            <div className="mt-2 font-bold text-2xl text-foreground">
              {burnRate}
              <span className="font-normal text-muted-foreground text-sm">
                /min
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
