"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc";

const ROLE_COLORS: Record<string, string> = {
  orchestrator: "bg-violet-500/20 text-violet-400",
  discovery: "bg-blue-500/20 text-blue-400",
  architect: "bg-indigo-500/20 text-indigo-400",
  frontend: "bg-cyan-500/20 text-cyan-400",
  backend: "bg-green-500/20 text-green-400",
  database: "bg-yellow-500/20 text-yellow-400",
  devops: "bg-orange-500/20 text-orange-400",
  testing: "bg-pink-500/20 text-pink-400",
  security: "bg-red-500/20 text-red-400",
  documentation: "bg-zinc-500/20 text-zinc-400",
  "ci-loop": "bg-amber-500/20 text-amber-400",
  deployment: "bg-emerald-500/20 text-emerald-400",
};

const STATUS_INDICATORS: Record<string, { color: string; label: string }> = {
  idle: { color: "bg-zinc-500", label: "Idle" },
  working: { color: "bg-green-500 animate-pulse", label: "Working" },
  waiting: { color: "bg-yellow-500", label: "Waiting" },
  terminated: { color: "bg-red-500", label: "Terminated" },
  error: { color: "bg-red-500", label: "Error" },
};

export default function FleetPage() {
  const [selectedSessionId, setSelectedSessionId] = useState("");

  // Get active sessions to pick from
  const sessionsQuery = trpc.sessions.list.useQuery(
    { status: "active", limit: 20 },
    { retry: false },
  );

  // Get fleet status for selected session
  const fleetQuery = trpc.fleet.status.useQuery(
    { sessionId: selectedSessionId },
    { enabled: !!selectedSessionId, refetchInterval: 5000, retry: false },
  );

  const stopMutation = trpc.fleet.stop.useMutation();

  const sessions = sessionsQuery.data?.sessions ?? [];
  const agents = fleetQuery.data?.agents ?? [];
  const fleetTasks = fleetQuery.data?.tasks ?? [];

  const totalTokens = agents.reduce(
    (sum, a) => sum + (a.tokensIn ?? 0) + (a.tokensOut ?? 0),
    0,
  );
  const totalCredits = fleetTasks.reduce(
    (sum, t) => sum + (t.creditsConsumed ?? 0),
    0,
  );
  const activeCount = agents.filter(
    (a) => a.status === "working" || a.status === "idle",
  ).length;
  const queuedCount = fleetTasks.filter((t) => t.status === "queued").length;

  async function handleStopAgent(agentId: string) {
    if (!selectedSessionId) return;
    await stopMutation.mutateAsync({ sessionId: selectedSessionId, agentId });
    fleetQuery.refetch();
  }

  async function handleStopAll() {
    if (!selectedSessionId) return;
    if (!confirm("Stop all agents in this session?")) return;
    await stopMutation.mutateAsync({ sessionId: selectedSessionId });
    fleetQuery.refetch();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Fleet Manager</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Monitor and manage your parallel AI agents.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={selectedSessionId}
            onChange={(e) => setSelectedSessionId(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-violet-500"
          >
            <option value="">Select session...</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id.slice(0, 12)} - {s.mode ?? "task"}
              </option>
            ))}
          </select>
          {selectedSessionId && agents.length > 0 && (
            <button
              onClick={handleStopAll}
              className="rounded-lg border border-red-800/50 bg-red-950/50 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-900/50"
            >
              Stop All
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-xs font-medium text-zinc-500">Active Agents</div>
          <div className="mt-2 text-2xl font-bold text-zinc-100">
            {activeCount}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-xs font-medium text-zinc-500">Queued Tasks</div>
          <div className="mt-2 text-2xl font-bold text-zinc-100">
            {queuedCount}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-xs font-medium text-zinc-500">Total Tokens</div>
          <div className="mt-2 text-2xl font-bold text-zinc-100">
            {totalTokens.toLocaleString()}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-xs font-medium text-zinc-500">Credits Used</div>
          <div className="mt-2 text-2xl font-bold text-zinc-100">
            {totalCredits.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Agent grid */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-zinc-200">
          Agent Grid
        </h2>

        {!selectedSessionId ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-12 text-center">
            <p className="text-sm text-zinc-500">
              Select a session above to view its agents
            </p>
          </div>
        ) : agents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-12 text-center">
            <p className="text-sm text-zinc-500">
              No agents running in this session
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              Agents will appear here when tasks are dispatched
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => {
              const statusInfo =
                STATUS_INDICATORS[agent.status] ?? STATUS_INDICATORS.idle;
              const roleColor =
                ROLE_COLORS[agent.role] ?? "bg-zinc-500/20 text-zinc-400";

              return (
                <div
                  key={agent.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700"
                >
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${roleColor}`}
                    >
                      {agent.role}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${statusInfo?.color ?? "bg-zinc-500"}`} />
                      <span className="text-[10px] text-zinc-500">
                        {statusInfo?.label ?? "unknown"}
                      </span>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] text-zinc-600">Tokens In</div>
                      <div className="font-mono text-xs text-zinc-300">
                        {(agent.tokensIn ?? 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-600">Tokens Out</div>
                      <div className="font-mono text-xs text-zinc-300">
                        {(agent.tokensOut ?? 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-600">Steps</div>
                      <div className="font-mono text-xs text-zinc-300">
                        {agent.stepsCompleted ?? 0}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-600">Started</div>
                      <div className="text-xs text-zinc-300">
                        {agent.startedAt
                          ? new Date(agent.startedAt).toLocaleTimeString()
                          : "--"}
                      </div>
                    </div>
                  </div>

                  {/* Current task */}
                  {fleetTasks
                    .filter(
                      (t) =>
                        t.agentRole === agent.role &&
                        (t.status === "running" || t.status === ("in_progress" as string)),
                    )
                    .slice(0, 1)
                    .map((task) => (
                      <div
                        key={task.id}
                        className="mt-3 rounded-lg bg-zinc-950 px-3 py-2"
                      >
                        <div className="text-[10px] text-zinc-600">
                          Current Task
                        </div>
                        <div className="mt-0.5 truncate text-xs text-zinc-300">
                          {task.title}
                        </div>
                      </div>
                    ))}

                  {/* Stop button */}
                  {(agent.status === "working" || agent.status === "idle") && (
                    <button
                      onClick={() => handleStopAgent(agent.id)}
                      className="mt-3 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-red-800/50 hover:bg-red-950/30 hover:text-red-400"
                    >
                      Stop Agent
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Credit usage breakdown */}
      {fleetTasks.length > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold text-zinc-200">
            Task Breakdown
          </h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
            <table className="w-full">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500">
                  <th className="px-4 py-3 font-medium">Task</th>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {fleetTasks.map((task) => (
                  <tr key={task.id} className="text-sm">
                    <td className="px-4 py-2.5 text-zinc-300">
                      <div className="truncate max-w-[240px]">{task.title}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${
                          ROLE_COLORS[task.agentRole ?? ""] ??
                          "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {task.agentRole ?? "--"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`text-xs ${
                          task.status === "completed"
                            ? "text-green-400"
                            : task.status === "failed"
                              ? "text-red-400"
                              : task.status === "running" || task.status === ("in_progress" as string)
                                ? "text-violet-400"
                                : "text-zinc-500"
                        }`}
                      >
                        {task.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-zinc-400">
                      {task.creditsConsumed ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
