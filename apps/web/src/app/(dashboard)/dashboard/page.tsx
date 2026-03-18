"use client";

import Link from "next/link";
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useDashboardStore } from "@/stores/dashboard.store";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500",
  paused: "bg-yellow-500",
  completed: "bg-blue-500",
  failed: "bg-red-500",
  cancelled: "bg-zinc-500",
};

/* ─── Skeleton helpers ──────────────────────────────────────────────── */

function StatCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-zinc-800" />
        <div className="h-3 w-24 rounded bg-zinc-800" />
      </div>
      <div className="mt-3 h-8 w-16 rounded bg-zinc-800" />
      <div className="mt-2 h-3 w-28 rounded bg-zinc-800" />
    </div>
  );
}

function SessionCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-zinc-700" />
          <div className="h-3 w-14 rounded bg-zinc-800" />
        </div>
        <div className="h-3 w-20 rounded bg-zinc-800" />
      </div>
      <div className="mt-3 h-4 w-32 rounded bg-zinc-800" />
      <div className="mt-2 h-3 w-20 rounded bg-zinc-800" />
      <div className="mt-2 h-3 w-28 rounded bg-zinc-800" />
    </div>
  );
}

function ProjectCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between">
        <div className="h-4 w-16 rounded bg-zinc-800" />
        <div className="h-3 w-20 rounded bg-zinc-800" />
      </div>
      <div className="mt-3 h-5 w-40 rounded bg-zinc-800" />
      <div className="mt-2 h-3 w-full rounded bg-zinc-800" />
      <div className="mt-1 h-3 w-3/4 rounded bg-zinc-800" />
      <div className="mt-4 h-3 w-24 rounded bg-zinc-800" />
    </div>
  );
}

/* ─── Main Dashboard Page ──────────────────────────────────────────── */

export default function DashboardPage() {
  const { creditBalance, activeAgents, setStats } = useDashboardStore();

  const projectsQuery = trpc.projects.list.useQuery(
    { limit: 6 },
    { retry: false }
  );
  const sessionsQuery = trpc.sessions.list.useQuery(
    { limit: 10 },
    { retry: false }
  );
  const balanceQuery = trpc.billing.getBalance.useQuery(undefined, {
    retry: false,
  });
  const overviewQuery = trpc.stats.overview.useQuery(
    { days: 1 },
    { retry: false }
  );

  useEffect(() => {
    if (balanceQuery.data) {
      setStats({ creditBalance: balanceQuery.data.available });
    }
  }, [balanceQuery.data, setStats]);

  const projects = projectsQuery.data?.projects ?? [];
  const sessions = sessionsQuery.data?.sessions ?? [];
  const overview = overviewQuery.data;
  const balance = balanceQuery.data;

  const activeSessions = sessions.filter((s) => s.status === "active");
  const isLoading =
    projectsQuery.isLoading ||
    sessionsQuery.isLoading ||
    balanceQuery.isLoading ||
    overviewQuery.isLoading;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-zinc-100 dark:text-zinc-100">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
            Welcome to PROMETHEUS. Your AI engineering platform.
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-violet-700"
            href="/dashboard/projects/new"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                d="M12 4.5v15m7.5-7.5h-15"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            New Project
          </Link>
          <Link
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 font-medium text-sm text-zinc-300 transition-colors hover:bg-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            href="/new"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            New Task
          </Link>
          <Link
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 font-medium text-sm text-zinc-300 transition-colors hover:bg-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            href="/dashboard/analytics"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              viewBox="0 0 24 24"
            >
              <path
                d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            View Analytics
          </Link>
        </div>
      </div>

      {/* Quick stats */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10">
                <svg
                  aria-hidden="true"
                  className="h-4 w-4 text-green-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span className="font-medium text-xs text-zinc-500 dark:text-zinc-500">
                Active Agents
              </span>
            </div>
            <div className="mt-3 font-bold text-3xl text-zinc-100 dark:text-zinc-100">
              {activeAgents}
            </div>
            <div className="mt-1 text-xs text-zinc-500">Running right now</div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-yellow-500/10">
                <svg
                  aria-hidden="true"
                  className="h-4 w-4 text-yellow-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path d="M10.75 10.818a2.608 2.608 0 01-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 01-1.279-.2 2.349 2.349 0 01-.96-.609 2.372 2.372 0 01-.535-.858A3.2 3.2 0 014.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 011.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766zM10 18a8 8 0 100-16 8 8 0 000 16z" />
                </svg>
              </div>
              <span className="font-medium text-xs text-zinc-500 dark:text-zinc-500">
                Credits Remaining
              </span>
            </div>
            <div className="mt-3 font-bold text-3xl text-zinc-100 dark:text-zinc-100">
              {balance?.available?.toLocaleString() ?? creditBalance}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {balance?.reserved
                ? `${balance.reserved} reserved`
                : "Available to use"}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                <svg
                  aria-hidden="true"
                  className="h-4 w-4 text-blue-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span className="font-medium text-xs text-zinc-500 dark:text-zinc-500">
                Tasks Today
              </span>
            </div>
            <div className="mt-3 font-bold text-3xl text-zinc-100 dark:text-zinc-100">
              {overview?.tasksCompleted ?? 0}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {overview?.successRate
                ? `${(overview.successRate * 100).toFixed(0)}% success rate`
                : "No tasks yet"}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 dark:border-zinc-800 dark:bg-zinc-900/50">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                <svg
                  aria-hidden="true"
                  className="h-4 w-4 text-violet-500"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <span className="font-medium text-xs text-zinc-500 dark:text-zinc-500">
                Active Projects
              </span>
            </div>
            <div className="mt-3 font-bold text-3xl text-zinc-100 dark:text-zinc-100">
              {overview?.activeProjects ?? 0}
            </div>
            <div className="mt-1 text-xs text-zinc-500">
              {overview?.sessionsCreated
                ? `${overview.sessionsCreated} sessions`
                : "Create one to start"}
            </div>
          </div>
        </div>
      )}

      {/* Active Sessions Summary */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-lg text-zinc-200 dark:text-zinc-200">
              Active Sessions
            </h2>
            {activeSessions.length > 0 && (
              <span className="rounded-full bg-green-500/10 px-2.5 py-0.5 font-medium text-green-400 text-xs">
                {activeSessions.length} running
              </span>
            )}
          </div>
          <Link
            className="text-violet-400 text-xs hover:text-violet-300"
            href="/dashboard/fleet"
          >
            View all
          </Link>
        </div>

        {sessionsQuery.isLoading && (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <SessionCardSkeleton />
            <SessionCardSkeleton />
            <SessionCardSkeleton />
          </div>
        )}
        {!(sessionsQuery.isLoading || sessions.length) && (
          <div className="rounded-xl border border-zinc-800 border-dashed bg-zinc-900/30 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
              <svg
                aria-hidden="true"
                className="h-6 w-6 text-zinc-500"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="M12 4.5v15m7.5-7.5h-15"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="mt-4 text-sm text-zinc-400 dark:text-zinc-400">
              No active sessions
            </p>
            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-600">
              Start a new task to see agent sessions here
            </p>
            <Link
              className="mt-4 inline-flex items-center rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white hover:bg-violet-700"
              href="/dashboard/projects/new"
            >
              New Task
            </Link>
          </div>
        )}
        {!sessionsQuery.isLoading && sessions.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {sessions.slice(0, 6).map((session) => (
              <Link
                className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                href={`/dashboard/projects/${session.projectId}/sessions/${session.id}`}
                key={session.id}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        STATUS_COLORS[session.status] ?? "bg-zinc-500"
                      } ${session.status === "active" ? "animate-pulse" : ""}`}
                    />
                    <span className="font-medium text-xs text-zinc-400 capitalize">
                      {session.status}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-zinc-600">
                    {session.id.slice(0, 12)}
                  </span>
                </div>
                <div className="mt-2 font-medium text-sm text-zinc-200 group-hover:text-zinc-100 dark:text-zinc-200 dark:group-hover:text-zinc-100">
                  {(session as Record<string, unknown>).project
                    ? (
                        (session as Record<string, unknown>).project as {
                          name: string;
                        }
                      ).name
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

      {/* Recent Projects */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold text-lg text-zinc-200 dark:text-zinc-200">
            Recent Projects
          </h2>
          <Link
            className="text-violet-400 text-xs hover:text-violet-300"
            href="/dashboard/projects"
          >
            View all
          </Link>
        </div>

        {projectsQuery.isLoading && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
          </div>
        )}
        {!projectsQuery.isLoading && projects.length === 0 && (
          <div className="rounded-xl border border-zinc-800 border-dashed bg-zinc-900/30 p-12 text-center dark:border-zinc-800 dark:bg-zinc-900/30">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
              <svg
                aria-hidden="true"
                className="h-6 w-6 text-zinc-500"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="mt-4 text-sm text-zinc-400">No projects yet</p>
            <p className="mt-1 text-xs text-zinc-600">
              Create your first project to get started.
            </p>
            <Link
              className="mt-4 inline-flex items-center rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white hover:bg-violet-700"
              href="/dashboard/projects/new"
            >
              Create Project
            </Link>
          </div>
        )}
        {!projectsQuery.isLoading && projects.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Link
                className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                href={`/dashboard/projects/${project.id}`}
                key={project.id}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${(() => {
                      if (project.status === "active") {
                        return "bg-green-500/10 text-green-400";
                      }
                      if (project.status === "setup") {
                        return "bg-yellow-500/10 text-yellow-400";
                      }
                      return "bg-zinc-500/10 text-zinc-400";
                    })()}`}
                  >
                    {project.status}
                  </span>
                  {project.techStackPreset && (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500">
                      {project.techStackPreset}
                    </span>
                  )}
                </div>
                <h3 className="mt-3 font-semibold text-sm text-zinc-200 group-hover:text-zinc-100 dark:text-zinc-200 dark:group-hover:text-zinc-100">
                  {project.name}
                </h3>
                {project.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                    {project.description}
                  </p>
                )}
                <div className="mt-4 text-[10px] text-zinc-600">
                  Updated{" "}
                  {new Date(
                    project.updatedAt ?? project.createdAt
                  ).toLocaleDateString()}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div>
        <h2 className="mb-4 font-semibold text-lg text-zinc-200 dark:text-zinc-200">
          Recent Activity
        </h2>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 dark:border-zinc-800 dark:bg-zinc-900/50">
          {useDashboardStore.getState().recentActivity.length === 0 ? (
            <div className="p-8 text-center text-sm text-zinc-500">
              No recent activity. Start a task to see updates here.
            </div>
          ) : (
            <div className="divide-y divide-zinc-800 dark:divide-zinc-800">
              {useDashboardStore
                .getState()
                .recentActivity.slice(0, 10)
                .map((activity) => (
                  <div
                    className="flex items-center gap-3 px-4 py-3"
                    key={activity.id}
                  >
                    <div className="h-1.5 w-1.5 rounded-full bg-violet-500" />
                    <span className="flex-1 text-sm text-zinc-300 dark:text-zinc-300">
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
