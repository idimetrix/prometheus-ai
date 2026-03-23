"use client";

import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FleetAgent {
  costUsd: number;
  filesChanged: number;
  id: string;
  progress: number; // 0-100
  role: string;
  status: "pending" | "running" | "completed" | "failed";
  tokensUsed: number;
}

interface FleetDashboardProps {
  agents: FleetAgent[];
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_STATUS_STYLES: Record<
  FleetAgent["status"],
  { badge: string; dot: string; label: string }
> = {
  pending: {
    badge: "bg-zinc-500/20 text-zinc-400",
    dot: "bg-zinc-400",
    label: "Pending",
  },
  running: {
    badge: "bg-blue-500/20 text-blue-300",
    dot: "bg-blue-400 animate-pulse",
    label: "Running",
  },
  completed: {
    badge: "bg-green-500/20 text-green-300",
    dot: "bg-green-400",
    label: "Complete",
  },
  failed: {
    badge: "bg-red-500/20 text-red-300",
    dot: "bg-red-400",
    label: "Failed",
  },
};

const ROLE_ICONS: Record<string, string> = {
  architect:
    "M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3H21m-3.75 3H21",
  coder:
    "M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5",
  reviewer:
    "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Zm3.75 11.625a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z",
  tester:
    "M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5",
  deployer:
    "M15.59 14.37a6 6 0 0 1-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 0 0 6.16-12.12A14.98 14.98 0 0 0 9.631 8.41m5.96 5.96a14.926 14.926 0 0 1-5.841 2.58m-.119-8.54a6 6 0 0 0-7.381 5.84h4.8m2.58-5.84a14.927 14.927 0 0 0-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 0 1-2.448-2.448 14.9 14.9 0 0 1 .06-.312m-2.24 2.39a4.493 4.493 0 0 0-1.757 4.306 4.493 4.493 0 0 0 4.306-1.758M16.5 9a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z",
};

// Default icon for unknown roles
const DEFAULT_ICON =
  "M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokens(tokens: number): string {
  if (tokens > 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens > 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toLocaleString();
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function getProgressBarColor(status: FleetAgent["status"]): string {
  if (status === "failed") {
    return "bg-red-500";
  }
  if (status === "completed") {
    return "bg-green-500";
  }
  return "bg-blue-500";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AgentCard({ agent }: { agent: FleetAgent }) {
  const statusStyle = AGENT_STATUS_STYLES[agent.status];
  const iconPath = ROLE_ICONS[agent.role.toLowerCase()] ?? DEFAULT_ICON;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 transition-colors hover:border-zinc-700">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-zinc-800">
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 text-zinc-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path d={iconPath} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate font-medium text-xs text-zinc-200">
            {agent.role}
          </span>
          <span className="font-mono text-[10px] text-zinc-600">
            {agent.id.slice(0, 8)}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${statusStyle.badge}`}
        >
          <span
            className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${statusStyle.dot}`}
          />
          {statusStyle.label}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">Progress</span>
          <span className="font-mono text-[10px] text-zinc-400">
            {agent.progress}%
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-300 ${getProgressBarColor(agent.status)}`}
            style={{ width: `${agent.progress}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <span className="block text-[10px] text-zinc-600">Files</span>
          <span className="font-mono text-xs text-zinc-300">
            {agent.filesChanged}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-zinc-600">Tokens</span>
          <span className="font-mono text-xs text-zinc-300">
            {formatTokens(agent.tokensUsed)}
          </span>
        </div>
        <div>
          <span className="block text-[10px] text-zinc-600">Cost</span>
          <span className="font-mono text-xs text-zinc-300">
            {formatCost(agent.costUsd)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FleetDashboard({ sessionId, agents }: FleetDashboardProps) {
  const totals = useMemo(() => {
    let filesChanged = 0;
    let tokensUsed = 0;
    let costUsd = 0;
    let completedCount = 0;
    let runningCount = 0;
    let failedCount = 0;

    for (const agent of agents) {
      filesChanged += agent.filesChanged;
      tokensUsed += agent.tokensUsed;
      costUsd += agent.costUsd;
      if (agent.status === "completed") {
        completedCount += 1;
      }
      if (agent.status === "running") {
        runningCount += 1;
      }
      if (agent.status === "failed") {
        failedCount += 1;
      }
    }

    return {
      filesChanged,
      tokensUsed,
      costUsd,
      completedCount,
      runningCount,
      failedCount,
    };
  }, [agents]);

  const overallProgress =
    agents.length > 0
      ? Math.round(
          agents.reduce((sum, a) => sum + a.progress, 0) / agents.length
        )
      : 0;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            {totals.runningCount > 0 && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                totals.runningCount > 0 ? "bg-green-500" : "bg-zinc-500"
              }`}
            />
          </span>
          <span className="font-medium text-sm text-zinc-300">
            {totals.runningCount} active
          </span>
        </div>

        <div className="h-4 w-px bg-zinc-700" />

        <div className="flex items-center gap-1.5 text-sm text-zinc-400">
          <span className="h-2 w-2 rounded-full bg-green-400" />
          {totals.completedCount} done
        </div>

        {totals.failedCount > 0 && (
          <div className="flex items-center gap-1.5 text-sm text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-red-400" />
            {totals.failedCount} failed
          </div>
        )}

        <div className="h-4 w-px bg-zinc-700" />

        <div className="text-sm text-zinc-400">
          <span className="font-mono">{formatTokens(totals.tokensUsed)}</span>{" "}
          tokens
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-zinc-500">Progress</span>
          <div className="h-2 w-32 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
          <span className="font-mono text-xs text-zinc-400">
            {overallProgress}%
          </span>
        </div>
      </div>

      {/* Session ID */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-600">Session:</span>
        <span className="font-mono text-[10px] text-zinc-500">{sessionId}</span>
      </div>

      {/* Agent grid */}
      {agents.length === 0 ? (
        <div className="flex h-32 items-center justify-center rounded-lg border border-zinc-800 border-dashed text-xs text-zinc-600">
          No agents in fleet
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard agent={agent} key={agent.id} />
          ))}
        </div>
      )}

      {/* Aggregate totals */}
      {agents.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-2">
          <span className="font-medium text-xs text-zinc-400">Totals</span>
          <div className="flex items-center gap-4 font-mono text-xs text-zinc-300">
            <span>{totals.filesChanged} files</span>
            <span>{formatTokens(totals.tokensUsed)} tokens</span>
            <span>{formatCost(totals.costUsd)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export type { FleetAgent, FleetDashboardProps };
