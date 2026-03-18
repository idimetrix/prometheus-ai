"use client";

import { trpc } from "@/lib/trpc";
import { useDashboardStore } from "@/stores/dashboard.store";
import Link from "next/link";
import { useEffect } from "react";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500",
  paused: "bg-yellow-500",
  completed: "bg-blue-500",
  failed: "bg-red-500",
  cancelled: "bg-zinc-500",
};

export default function DashboardPage() {
  const { creditBalance, activeAgents, setStats } = useDashboardStore();

  const sessionsQuery = trpc.sessions.list.useQuery(
    { limit: 10 },
    { retry: false },
  );
  const balanceQuery = trpc.billing.getBalance.useQuery(undefined, {
    retry: false,
  });
  const overviewQuery = trpc.analytics.overview.useQuery(
    { days: 1 },
    { retry: false },
  );

  useEffect(() => {
    if (balanceQuery.data) {
      setStats({ creditBalance: balanceQuery.data.available });
    }
  }, [balanceQuery.data, setStats]);

  const sessions = sessionsQuery.data?.sessions ?? [];
  const overview = overviewQuery.data;
  const balance = balanceQuery.data;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Welcome to PROMETHEUS. Your AI engineering platform.
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/dashboard/projects/new"
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            New Task
          </Link>
          <Link
            href="/dashboard/fleet"
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            View Fleet
          </Link>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
              <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
            </div>
            <span className="text-xs font-medium text-zinc-500">Active Agents</span>
          </div>
          <div className="mt-3 text-3xl font-bold text-zinc-100">{activeAgents}</div>
          <div className="mt-1 text-xs text-zinc-500">Running right now</div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500/10">
              <svg className="h-4 w-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10.75 10.818a2.608 2.608 0 0 1-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 0 1-1.279-.2 2.349 2.349 0 0 1-.96-.609 2.372 2.372 0 0 1-.535-.858A3.2 3.2 0 0 1 4.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 0 1 1.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766ZM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
              </svg>
            </div>
            <span className="text-xs font-medium text-zinc-500">Credits Remaining</span>
          </div>
          <div className="mt-3 text-3xl font-bold text-zinc-100">
            {balance?.available?.toLocaleString() ?? creditBalance}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {balance?.reserved ? `${balance.reserved} reserved` : "Available to use"}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
              <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <span className="text-xs font-medium text-zinc-500">Tasks Today</span>
          </div>
          <div className="mt-3 text-3xl font-bold text-zinc-100">
            {overview?.tasksCompleted ?? 0}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {overview?.successRate
              ? `${(overview.successRate * 100).toFixed(0)}% success rate`
              : "No tasks yet"}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
              <svg className="h-4 w-4 text-violet-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
              </svg>
            </div>
            <span className="text-xs font-medium text-zinc-500">Active Projects</span>
          </div>
          <div className="mt-3 text-3xl font-bold text-zinc-100">
            {overview?.activeProjects ?? 0}
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {overview?.sessionsCreated
              ? `${overview.sessionsCreated} sessions`
              : "Create one to start"}
          </div>
        </div>
      </div>

      {/* Active sessions */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-200">Active Sessions</h2>
          <Link
            href="/dashboard/fleet"
            className="text-xs text-violet-400 hover:text-violet-300"
          >
            View all
          </Link>
        </div>

        {sessions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-12 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
              <svg className="h-6 w-6 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <p className="mt-4 text-sm text-zinc-400">No active sessions</p>
            <p className="mt-1 text-xs text-zinc-600">
              Start a new task to see agent sessions here
            </p>
            <Link
              href="/dashboard/projects/new"
              className="mt-4 inline-flex items-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
            >
              New Task
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {sessions.map((session) => (
              <Link
                key={session.id}
                href={`/dashboard/sessions/${session.id}`}
                className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        STATUS_COLORS[session.status] ?? "bg-zinc-500"
                      }`}
                    />
                    <span className="text-xs font-medium capitalize text-zinc-400">
                      {session.status}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-zinc-600">
                    {session.id.slice(0, 12)}
                  </span>
                </div>
                <div className="mt-2 text-sm font-medium text-zinc-200 group-hover:text-zinc-100">
                  {(session as Record<string, unknown>).project
                    ? ((session as Record<string, unknown>).project as { name: string }).name
                    : "Untitled Session"}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  Mode: {session.mode ?? "task"}
                </div>
                <div className="mt-2 text-[10px] text-zinc-600">
                  {session.startedAt
                    ? new Date(session.startedAt).toLocaleString()
                    : "Not started"}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div>
        <h2 className="mb-4 text-lg font-semibold text-zinc-200">
          Recent Activity
        </h2>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
          {useDashboardStore.getState().recentActivity.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">
              No recent activity. Start a task to see updates here.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800">
              {useDashboardStore
                .getState()
                .recentActivity.slice(0, 10)
                .map((activity) => (
                  <div key={activity.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                    <span className="flex-1 text-sm text-zinc-300">
                      {activity.message}
                    </span>
                    <span className="text-xs text-zinc-600">
                      {new Date(activity.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
