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

function taskBorderBg(status: string): string {
  if (status === "completed") {
    return "border-green-500/30 bg-green-500/10";
  }
  if (status === "running" || status === ("in_progress" as string)) {
    return "border-violet-500/30 bg-violet-500/10";
  }
  if (status === "failed") {
    return "border-red-500/30 bg-red-500/10";
  }
  return "border-zinc-800 bg-zinc-950";
}

function taskTextColor(status: string): string {
  if (status === "completed") {
    return "text-green-400";
  }
  if (status === "running" || status === ("in_progress" as string)) {
    return "text-violet-400";
  }
  if (status === "failed") {
    return "text-red-400";
  }
  return "text-zinc-500";
}

const STATUS_INDICATORS: Record<string, { color: string; label: string }> = {
  idle: { color: "bg-zinc-500", label: "Idle" },
  working: { color: "bg-green-500 animate-pulse", label: "Working" },
  waiting: { color: "bg-yellow-500", label: "Waiting" },
  paused: { color: "bg-yellow-500", label: "Paused" },
  terminated: { color: "bg-red-500", label: "Terminated" },
  error: { color: "bg-red-500", label: "Error" },
};

export default function FleetPage() {
  const [selectedSessionId, setSelectedSessionId] = useState("");

  // Get active sessions to pick from
  const sessionsQuery = trpc.sessions.list.useQuery(
    { status: "active", limit: 20 },
    { retry: false }
  );

  // Get fleet status for selected session
  const fleetQuery = trpc.fleet.status.useQuery(
    { sessionId: selectedSessionId },
    { enabled: !!selectedSessionId, refetchInterval: 5000, retry: false }
  );

  const stopMutation = trpc.fleet.stop.useMutation();
  const pauseMutation = trpc.fleet.pause.useMutation();
  const resumeMutation = trpc.fleet.resume.useMutation();

  const sessions = sessionsQuery.data?.sessions ?? [];
  const agents = fleetQuery.data?.agents ?? [];
  const fleetTasks = fleetQuery.data?.tasks ?? [];

  const totalTokens = agents.reduce(
    (sum, a) => sum + (a.tokensIn ?? 0) + (a.tokensOut ?? 0),
    0
  );
  const totalCredits = fleetTasks.reduce(
    (sum, t) => sum + (t.creditsConsumed ?? 0),
    0
  );
  const activeCount = agents.filter(
    (a) => a.status === "working" || a.status === "idle"
  ).length;
  const completedTasks = fleetTasks.filter(
    (t) => t.status === "completed"
  ).length;
  const progressPct =
    fleetTasks.length > 0
      ? Math.round((completedTasks / fleetTasks.length) * 100)
      : 0;

  async function handleStopAgent(agentId: string) {
    if (!selectedSessionId) {
      return;
    }
    await stopMutation.mutateAsync({ sessionId: selectedSessionId, agentId });
    fleetQuery.refetch();
  }

  async function handlePauseAgent(agentId: string) {
    if (!selectedSessionId) {
      return;
    }
    await pauseMutation.mutateAsync({ sessionId: selectedSessionId, agentId });
    fleetQuery.refetch();
  }

  async function handleResumeAgent(agentId: string) {
    if (!selectedSessionId) {
      return;
    }
    await resumeMutation.mutateAsync({ sessionId: selectedSessionId, agentId });
    fleetQuery.refetch();
  }

  async function handleStopAll() {
    if (!selectedSessionId) {
      return;
    }
    // biome-ignore lint/suspicious/noAlert: TODO replace with dialog component
    if (!confirm("Stop all agents in this session?")) {
      return;
    }
    await stopMutation.mutateAsync({ sessionId: selectedSessionId });
    fleetQuery.refetch();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-zinc-100">Fleet Manager</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Monitor and manage your parallel AI agents.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-violet-500"
            onChange={(e) => setSelectedSessionId(e.target.value)}
            value={selectedSessionId}
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
              className="rounded-lg border border-red-800/50 bg-red-950/50 px-3 py-1.5 font-medium text-red-400 text-xs hover:bg-red-900/50"
              onClick={handleStopAll}
              type="button"
            >
              Stop All
            </button>
          )}
        </div>
      </div>

      {/* Fleet-level stats bar */}
      <div className="grid gap-4 md:grid-cols-5">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="font-medium text-xs text-zinc-500">
            Total Progress
          </div>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-violet-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="font-bold text-lg text-zinc-100">
              {progressPct}%
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="font-medium text-xs text-zinc-500">
            Agents Running
          </div>
          <div className="mt-2 font-bold text-2xl text-zinc-100">
            {activeCount}
            <span className="font-normal text-sm text-zinc-500">
              /{agents.length}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="font-medium text-xs text-zinc-500">
            Credits Consumed
          </div>
          <div className="mt-2 font-bold text-2xl text-zinc-100">
            {totalCredits.toLocaleString()}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="font-medium text-xs text-zinc-500">Total Tokens</div>
          <div className="mt-2 font-bold text-2xl text-zinc-100">
            {totalTokens.toLocaleString()}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="font-medium text-xs text-zinc-500">
            Tasks Complete
          </div>
          <div className="mt-2 font-bold text-2xl text-zinc-100">
            {completedTasks}
            <span className="font-normal text-sm text-zinc-500">
              /{fleetTasks.length}
            </span>
          </div>
        </div>
      </div>

      {/* Task dependency mini-graph */}
      {fleetTasks.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <h2 className="mb-3 font-semibold text-sm text-zinc-200">
            Task Execution Order
          </h2>
          <div className="flex items-center gap-1 overflow-x-auto pb-2">
            {fleetTasks.map((task, i) => (
              <div className="flex shrink-0 items-center" key={task.id}>
                <div
                  className={`rounded-lg border px-3 py-2 ${taskBorderBg(task.status)}`}
                  title={task.title}
                >
                  <div
                    className={`max-w-[120px] truncate font-medium text-xs ${taskTextColor(task.status)}`}
                  >
                    {task.title}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    {task.agentRole && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 font-medium text-[8px] ${
                          ROLE_COLORS[task.agentRole] ??
                          "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {task.agentRole}
                      </span>
                    )}
                    <span className="text-[8px] text-zinc-600">
                      {task.status}
                    </span>
                  </div>
                </div>
                {i < fleetTasks.length - 1 && (
                  <svg
                    aria-hidden="true"
                    className="mx-1 h-4 w-5 shrink-0 text-zinc-700"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    viewBox="0 0 20 16"
                  >
                    <path
                      d="M2 8h14m0 0-4-4m4 4-4 4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent grid */}
      <div>
        <h2 className="mb-4 font-semibold text-lg text-zinc-200">Agent Grid</h2>

        {selectedSessionId && agents.length === 0 && (
          <div className="rounded-xl border border-zinc-800 border-dashed bg-zinc-900/30 p-12 text-center">
            <p className="text-sm text-zinc-500">
              No agents running in this session
            </p>
            <p className="mt-1 text-xs text-zinc-600">
              Agents will appear here when tasks are dispatched
            </p>
          </div>
        )}
        {selectedSessionId && agents.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => {
              const statusInfo =
                STATUS_INDICATORS[agent.status] ?? STATUS_INDICATORS.idle;
              const roleColor =
                ROLE_COLORS[agent.role] ?? "bg-zinc-500/20 text-zinc-400";
              const agentCredits = fleetTasks
                .filter((t) => t.agentRole === agent.role)
                .reduce((sum, t) => sum + (t.creditsConsumed ?? 0), 0);

              return (
                <div
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700"
                  key={agent.id}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-medium text-xs ${roleColor}`}
                    >
                      {agent.role}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 rounded-full ${statusInfo?.color ?? "bg-zinc-500"}`}
                      />
                      <span className="text-[10px] text-zinc-500">
                        {statusInfo?.label ?? "unknown"}
                      </span>
                    </div>
                  </div>

                  {/* Agent ID */}
                  <div className="mt-1 font-mono text-[10px] text-zinc-600">
                    {agent.id.slice(0, 16)}
                  </div>

                  {/* Stats */}
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[10px] text-zinc-600">Tokens In</div>
                      <div className="font-mono text-xs text-zinc-300">
                        {(agent.tokensIn ?? 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-600">
                        Tokens Out
                      </div>
                      <div className="font-mono text-xs text-zinc-300">
                        {(agent.tokensOut ?? 0).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-zinc-600">Credits</div>
                      <div className="font-mono text-xs text-zinc-300">
                        {agentCredits}
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
                        (t.status === "running" ||
                          t.status === ("in_progress" as string))
                    )
                    .slice(0, 1)
                    .map((task) => (
                      <div
                        className="mt-3 rounded-lg bg-zinc-950 px-3 py-2"
                        key={task.id}
                      >
                        <div className="text-[10px] text-zinc-600">
                          Current Task
                        </div>
                        <div className="mt-0.5 truncate text-xs text-zinc-300">
                          {task.title}
                        </div>
                      </div>
                    ))}

                  {/* Agent controls: pause, resume, stop */}
                  {agent.status !== "terminated" &&
                    agent.status !== "error" && (
                      <div className="mt-3 flex gap-1.5">
                        {agent.status === "working" && (
                          <button
                            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-yellow-800/50 hover:text-yellow-400"
                            onClick={() => handlePauseAgent(agent.id)}
                            type="button"
                          >
                            Pause
                          </button>
                        )}
                        {(agent.status === "idle" ||
                          agent.status === ("waiting" as string) ||
                          agent.status === ("paused" as string)) && (
                          <button
                            className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-green-800/50 hover:text-green-400"
                            onClick={() => handleResumeAgent(agent.id)}
                            type="button"
                          >
                            Resume
                          </button>
                        )}
                        <button
                          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-red-800/50 hover:bg-red-950/30 hover:text-red-400"
                          onClick={() => handleStopAgent(agent.id)}
                          type="button"
                        >
                          Stop
                        </button>
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        )}
        {!selectedSessionId && (
          <div className="rounded-xl border border-zinc-800 border-dashed bg-zinc-900/30 p-12 text-center">
            <p className="text-sm text-zinc-500">
              Select a session above to view its agents
            </p>
          </div>
        )}
      </div>

      {/* Credit usage breakdown table */}
      {fleetTasks.length > 0 && (
        <div>
          <h2 className="mb-4 font-semibold text-lg text-zinc-200">
            Task Breakdown
          </h2>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
            <table className="w-full">
              <thead>
                <tr className="border-zinc-800 border-b text-left text-xs text-zinc-500">
                  <th className="px-4 py-3 font-medium">Task</th>
                  <th className="px-4 py-3 font-medium">Agent</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {fleetTasks.map((task) => (
                  <tr className="text-sm" key={task.id}>
                    <td className="px-4 py-2.5 text-zinc-300">
                      <div className="max-w-[240px] truncate">{task.title}</div>
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
                      <span className={`text-xs ${taskTextColor(task.status)}`}>
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
