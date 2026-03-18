"use client";

import Link from "next/link";
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

interface FleetModeProps {
  sessionId: string;
}

export function FleetMode({ sessionId }: FleetModeProps) {
  const fleetQuery = trpc.fleet.status.useQuery(
    { sessionId },
    { refetchInterval: 5000, retry: false }
  );

  const pauseMutation = trpc.fleet.pause.useMutation();
  const resumeMutation = trpc.fleet.resume.useMutation();
  const stopMutation = trpc.fleet.stop.useMutation();

  const agents = fleetQuery.data?.agents ?? [];
  const tasks = fleetQuery.data?.tasks ?? [];

  const activeCount = agents.filter(
    (a) => a.status === "working" || a.status === "idle"
  ).length;
  const totalCredits = tasks.reduce(
    (sum, t) => sum + (t.creditsConsumed ?? 0),
    0
  );
  const completedTasks = tasks.filter((t) => t.status === "completed").length;
  const progressPct =
    tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;

  async function handlePauseAgent(agentId: string) {
    await pauseMutation.mutateAsync({ sessionId, agentId });
    fleetQuery.refetch();
  }

  async function handleResumeAgent(agentId: string) {
    await resumeMutation.mutateAsync({ sessionId, agentId });
    fleetQuery.refetch();
  }

  async function handleStopAgent(agentId: string) {
    await stopMutation.mutateAsync({ sessionId, agentId });
    fleetQuery.refetch();
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="font-medium text-[10px] text-zinc-500">
            Overall Progress
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-violet-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="font-bold text-sm text-zinc-100">
              {progressPct}%
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="font-medium text-[10px] text-zinc-500">
            Agents Running
          </div>
          <div className="mt-1 font-bold text-xl text-zinc-100">
            {activeCount}
            <span className="font-normal text-xs text-zinc-500">
              /{agents.length}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="font-medium text-[10px] text-zinc-500">
            Credits Consumed
          </div>
          <div className="mt-1 font-bold text-xl text-zinc-100">
            {totalCredits.toLocaleString()}
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
          <div className="font-medium text-[10px] text-zinc-500">
            Tasks Complete
          </div>
          <div className="mt-1 font-bold text-xl text-zinc-100">
            {completedTasks}
            <span className="font-normal text-xs text-zinc-500">
              /{tasks.length}
            </span>
          </div>
        </div>
      </div>

      {/* Agent grid */}
      <div className="flex-1 overflow-auto">
        {agents.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-xl border border-zinc-800 border-dashed bg-zinc-900/30">
            <div className="text-center">
              <p className="text-sm text-zinc-500">No agents dispatched yet</p>
              <p className="mt-1 text-xs text-zinc-600">
                Agents will appear here as tasks are distributed
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => {
              const statusInfo =
                STATUS_INDICATORS[agent.status] ?? STATUS_INDICATORS.idle;
              const roleColor =
                ROLE_COLORS[agent.role] ?? "bg-zinc-500/20 text-zinc-400";
              const agentTask = tasks.find(
                (t) =>
                  t.agentRole === agent.role &&
                  (t.status === "running" ||
                    t.status === ("in_progress" as string))
              );

              return (
                <div
                  className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700"
                  key={agent.id}
                >
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

                  <div className="mt-1 font-mono text-[10px] text-zinc-600">
                    {agent.id.slice(0, 16)}
                  </div>

                  {agentTask && (
                    <div className="mt-3 rounded-lg bg-zinc-950 px-3 py-2">
                      <div className="text-[10px] text-zinc-600">
                        Current Task
                      </div>
                      <div className="mt-0.5 truncate text-xs text-zinc-300">
                        {agentTask.title}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                    <div>
                      <span className="text-zinc-600">Credits: </span>
                      <span className="font-mono text-zinc-400">
                        {tasks
                          .filter((t) => t.agentRole === agent.role)
                          .reduce(
                            (sum, t) => sum + (t.creditsConsumed ?? 0),
                            0
                          )}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-600">Steps: </span>
                      <span className="font-mono text-zinc-400">
                        {agent.stepsCompleted ?? 0}
                      </span>
                    </div>
                  </div>

                  {/* Agent controls */}
                  <div className="mt-3 flex gap-1.5">
                    {agent.status === "working" && (
                      <button
                        className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 text-[10px] text-zinc-400 transition-colors hover:border-yellow-800/50 hover:text-yellow-400"
                        onClick={() => handlePauseAgent(agent.id)}
                      >
                        Pause
                      </button>
                    )}
                    {(agent.status === "idle" ||
                      agent.status === ("waiting" as string)) && (
                      <button
                        className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 text-[10px] text-zinc-400 transition-colors hover:border-green-800/50 hover:text-green-400"
                        onClick={() => handleResumeAgent(agent.id)}
                      >
                        Resume
                      </button>
                    )}
                    {agent.status !== "terminated" &&
                      agent.status !== "error" && (
                        <button
                          className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 text-[10px] text-zinc-400 transition-colors hover:border-red-800/50 hover:text-red-400"
                          onClick={() => handleStopAgent(agent.id)}
                        >
                          Stop
                        </button>
                      )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Task dependency mini-graph */}
      {tasks.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="mb-3 font-medium text-xs text-zinc-400">
            Task Execution Order
          </div>
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {tasks.map((task, i) => (
              <div className="flex shrink-0 items-center" key={task.id}>
                <div
                  className={`rounded-lg border px-3 py-1.5 text-[10px] ${
                    task.status === "completed"
                      ? "border-green-500/30 bg-green-500/10 text-green-400"
                      : task.status === "running" ||
                          task.status === ("in_progress" as string)
                        ? "border-violet-500/30 bg-violet-500/10 text-violet-400"
                        : task.status === "failed"
                          ? "border-red-500/30 bg-red-500/10 text-red-400"
                          : "border-zinc-800 bg-zinc-950 text-zinc-500"
                  }`}
                  title={task.title}
                >
                  <div className="max-w-[100px] truncate font-medium">
                    {task.title}
                  </div>
                  <div className="mt-0.5 text-[8px] opacity-60">
                    {task.agentRole ?? "unassigned"}
                  </div>
                </div>
                {i < tasks.length - 1 && (
                  <svg
                    className="mx-0.5 h-3 w-4 shrink-0 text-zinc-700"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    viewBox="0 0 16 12"
                  >
                    <path
                      d="M1 6h12m0 0-3-3m3 3-3 3"
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

      {/* Link to full fleet dashboard */}
      <div className="flex justify-end">
        <Link
          className="text-violet-400 text-xs transition-colors hover:text-violet-300"
          href="/dashboard/fleet"
        >
          Open full Fleet Dashboard
        </Link>
      </div>
    </div>
  );
}
