"use client";

import { useCallback, useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type AgentStatus = "active" | "idle" | "error" | "waiting";
type SortField = "name" | "status" | "tokens" | "duration";
type SortDir = "asc" | "desc";

interface AgentSession {
  agentRole: string;
  duration: number;
  id: string;
  name: string;
  sessionId: string;
  status: AgentStatus;
  tokensUsed: number;
}

interface AgentActivityDashboardProps {
  className?: string;
  onSelectSession?: (sessionId: string) => void;
  sessions: AgentSession[];
  statusFilter?: AgentStatus | "all";
  totalTokens?: number;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const STATUS_COLOR: Record<AgentStatus, string> = {
  active: "bg-green-500",
  error: "bg-red-500",
  idle: "bg-zinc-500",
  waiting: "bg-yellow-500 animate-pulse",
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return String(tokens);
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function AgentActivityDashboard({
  sessions,
  totalTokens = 0,
  statusFilter: initialFilter = "all",
  onSelectSession,
  className = "",
}: AgentActivityDashboardProps) {
  const [sortField, setSortField] = useState<SortField>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState<AgentStatus | "all">(initialFilter);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDir("asc");
      }
    },
    [sortField]
  );

  const filteredAndSorted = useMemo(() => {
    let result =
      filter === "all" ? sessions : sessions.filter((s) => s.status === filter);

    result = [...result].sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") {
        cmp = a.name.localeCompare(b.name);
      } else if (sortField === "status") {
        cmp = a.status.localeCompare(b.status);
      } else if (sortField === "tokens") {
        cmp = a.tokensUsed - b.tokensUsed;
      } else {
        cmp = a.duration - b.duration;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [sessions, filter, sortField, sortDir]);

  const activeSessions = sessions.filter((s) => s.status === "active").length;

  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
          <span className="text-xs text-zinc-500">Live Sessions</span>
          <div className="mt-1 font-bold text-2xl text-zinc-100">
            {activeSessions}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
          <span className="text-xs text-zinc-500">Total Sessions</span>
          <div className="mt-1 font-bold text-2xl text-zinc-100">
            {sessions.length}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
          <span className="text-xs text-zinc-500">Token Usage</span>
          <div className="mt-1 font-bold text-2xl text-zinc-100">
            {formatTokens(totalTokens)}
          </div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
          <span className="text-xs text-zinc-500">Error Rate</span>
          <div className="mt-1 font-bold text-2xl text-zinc-100">
            {sessions.length > 0
              ? `${((sessions.filter((s) => s.status === "error").length / sessions.length) * 100).toFixed(1)}%`
              : "0%"}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {(["all", "active", "idle", "waiting", "error"] as const).map((f) => (
          <button
            className={`rounded px-2 py-1 text-xs ${
              filter === f
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
            key={f}
            onClick={() => setFilter(f)}
            type="button"
          >
            {f === "all" ? "All" : f}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-zinc-700 border-b bg-zinc-900/60">
              {(
                [
                  ["name", "Agent"],
                  ["status", "Status"],
                  ["tokens", "Tokens"],
                  ["duration", "Duration"],
                ] as [SortField, string][]
              ).map(([field, label]) => (
                <th
                  className="cursor-pointer px-3 py-2 text-left text-xs text-zinc-500 hover:text-zinc-300"
                  key={field}
                  onClick={() => handleSort(field)}
                >
                  {label}
                  {sortField === field && (
                    <span className="ml-1">
                      {sortDir === "asc" ? "^" : "v"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredAndSorted.map((session) => (
              <tr
                className="cursor-pointer border-zinc-800 border-b hover:bg-zinc-800/40"
                key={session.id}
                onClick={() => onSelectSession?.(session.sessionId)}
              >
                <td className="px-3 py-2">
                  <div className="text-zinc-200">{session.name}</div>
                  <div className="text-[10px] text-zinc-600">
                    {session.agentRole}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`h-2 w-2 rounded-full ${STATUS_COLOR[session.status]}`}
                    />
                    <span className="text-xs text-zinc-400">
                      {session.status}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-400">
                  {formatTokens(session.tokensUsed)}
                </td>
                <td className="px-3 py-2 text-xs text-zinc-500">
                  {formatDuration(session.duration)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export type { AgentActivityDashboardProps, AgentSession, AgentStatus };
