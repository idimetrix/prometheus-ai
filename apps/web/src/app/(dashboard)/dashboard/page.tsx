"use client";

import { Badge, Button, Card, CardContent, Skeleton } from "@prometheus/ui";
import {
  BarChart3,
  CheckCircle,
  Coins,
  Cpu,
  FolderOpen,
  Plus,
  Zap,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect } from "react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { trpc } from "@/lib/trpc";
import { useDashboardStore } from "@/stores/dashboard.store";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500",
  paused: "bg-yellow-500",
  completed: "bg-blue-500",
  failed: "bg-red-500",
  cancelled: "bg-zinc-500",
};

/* --- Skeleton helpers ---------------------------------------------------- */

function StatCardSkeleton() {
  return (
    <Card className="border-zinc-800 bg-zinc-900/50 p-5">
      <CardContent className="p-0">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-3 w-24" />
        </div>
        <Skeleton className="mt-3 h-8 w-16" />
        <Skeleton className="mt-2 h-3 w-28" />
      </CardContent>
    </Card>
  );
}

function SessionCardSkeleton() {
  return (
    <Card className="border-zinc-800 bg-zinc-900/50 p-4">
      <CardContent className="p-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-3 w-14" />
          </div>
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="mt-3 h-4 w-32" />
        <Skeleton className="mt-2 h-3 w-20" />
        <Skeleton className="mt-2 h-3 w-28" />
      </CardContent>
    </Card>
  );
}

function ProjectCardSkeleton() {
  return (
    <Card className="border-zinc-800 bg-zinc-900/50 p-5">
      <CardContent className="p-0">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="mt-3 h-5 w-40" />
        <Skeleton className="mt-2 h-3 w-full" />
        <Skeleton className="mt-1 h-3 w-3/4" />
        <Skeleton className="mt-4 h-3 w-24" />
      </CardContent>
    </Card>
  );
}

/* --- Main Dashboard Page ------------------------------------------------- */

function DashboardHeader() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="font-bold text-xl text-zinc-100 sm:text-2xl">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Welcome to PROMETHEUS. Your AI engineering platform.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 sm:gap-3">
        <Button asChild className="min-h-[44px]">
          <Link href="/dashboard/projects/new">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Project</span>
            <span className="sm:hidden">New</span>
          </Link>
        </Button>
        <Button asChild className="min-h-[44px]" variant="outline">
          <Link href="/new">
            <Zap className="h-4 w-4" />
            <span className="hidden sm:inline">New Task</span>
            <span className="sm:hidden">Task</span>
          </Link>
        </Button>
        <Button
          asChild
          className="hidden min-h-[44px] sm:inline-flex"
          variant="outline"
        >
          <Link href="/dashboard/analytics">
            <BarChart3 className="h-4 w-4" />
            View Analytics
          </Link>
        </Button>
      </div>
    </div>
  );
}

function StatsGrid({
  activeAgents,
  balance,
  overview,
  creditBalance,
}: {
  activeAgents: number;
  balance: { available: number; reserved: number } | undefined;
  overview:
    | {
        successRate: number;
        tasksCompleted: number;
        sessionsCreated: number;
        activeProjects: number;
      }
    | undefined;
  creditBalance: number;
}) {
  const creditsSubtitle = balance?.reserved
    ? `${balance.reserved} reserved`
    : "Available to use";
  const creditsTrend =
    balance?.available && balance.available > 0 ? "flat" : "down";
  const tasksSubtitle = overview?.successRate
    ? `${(overview.successRate * 100).toFixed(0)}% success rate`
    : "No tasks yet";
  const projectsSubtitle = overview?.sessionsCreated
    ? `${overview.sessionsCreated} sessions`
    : "Create one to start";

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        icon={Cpu}
        iconBg="bg-green-500/10"
        iconColor="text-green-500"
        label="Active Agents"
        subtitle="Running right now"
        trend={[0, 1, 2, 1, 3, 2, activeAgents]}
        trendDirection={activeAgents > 0 ? "up" : "flat"}
        value={activeAgents}
      />
      <MetricCard
        icon={Coins}
        iconBg="bg-yellow-500/10"
        iconColor="text-yellow-500"
        label="Credits Remaining"
        subtitle={creditsSubtitle}
        trendDirection={creditsTrend}
        value={balance?.available?.toLocaleString() ?? creditBalance}
      />
      <MetricCard
        icon={CheckCircle}
        iconBg="bg-blue-500/10"
        iconColor="text-blue-500"
        label="Tasks Today"
        subtitle={tasksSubtitle}
        trendDirection={(overview?.tasksCompleted ?? 0) > 0 ? "up" : "flat"}
        value={overview?.tasksCompleted ?? 0}
      />
      <MetricCard
        icon={FolderOpen}
        iconBg="bg-violet-500/10"
        iconColor="text-violet-500"
        label="Active Projects"
        subtitle={projectsSubtitle}
        trendDirection={(overview?.activeProjects ?? 0) > 0 ? "up" : "flat"}
        value={overview?.activeProjects ?? 0}
      />
    </div>
  );
}

export default function DashboardPage() {
  const { creditBalance, activeAgents, recentActivity, setStats } =
    useDashboardStore();

  const projectsQuery = trpc.projects.list.useQuery({ limit: 6 }, { retry: 2 });
  const sessionsQuery = trpc.sessions.list.useQuery(
    { limit: 10 },
    { retry: 2 }
  );
  const balanceQuery = trpc.billing.getBalance.useQuery(undefined, {
    retry: 2,
  });
  const overviewQuery = trpc.stats.overview.useQuery({ days: 1 }, { retry: 2 });

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

  const hasError =
    !isLoading &&
    (projectsQuery.isError ||
      sessionsQuery.isError ||
      balanceQuery.isError ||
      overviewQuery.isError);

  const handleRetryAll = () => {
    projectsQuery.refetch();
    sessionsQuery.refetch();
    balanceQuery.refetch();
    overviewQuery.refetch();
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <DashboardHeader />

      {/* Error state */}
      {hasError && (
        <Card className="border-red-500/30 bg-red-500/5 p-6">
          <CardContent className="flex items-center justify-between p-0">
            <p className="text-red-400 text-sm">
              Failed to load dashboard data. Please refresh the page.
            </p>
            <Button onClick={handleRetryAll} size="sm" variant="outline">
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Quick stats */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : (
        <StatsGrid
          activeAgents={activeAgents}
          balance={balance}
          creditBalance={creditBalance}
          overview={overview}
        />
      )}

      {/* Active Sessions Summary */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-lg text-zinc-200">
              Active Sessions
            </h2>
            {activeSessions.length > 0 && (
              <Badge variant="success">{activeSessions.length} running</Badge>
            )}
          </div>
          <Link
            className="text-violet-400 text-xs hover:text-violet-300"
            href={"/dashboard/sessions" as Route}
          >
            View all
          </Link>
        </div>

        {sessionsQuery.isLoading && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SessionCardSkeleton />
            <SessionCardSkeleton />
            <SessionCardSkeleton />
          </div>
        )}
        {!(sessionsQuery.isLoading || sessions.length) && (
          <Card className="border-zinc-800 border-dashed bg-zinc-900/30 p-12 text-center">
            <CardContent className="p-0">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
                <Plus className="h-6 w-6 text-zinc-500" />
              </div>
              <p className="mt-4 text-sm text-zinc-400">No active sessions</p>
              <p className="mt-1 text-xs text-zinc-600">
                Start a new task to see agent sessions here
              </p>
              <Button asChild className="mt-4">
                <Link href="/new">New Task</Link>
              </Button>
            </CardContent>
          </Card>
        )}
        {!sessionsQuery.isLoading && sessions.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.slice(0, 6).map((session) => (
              <Link
                className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
                href={
                  session.projectId
                    ? `/dashboard/projects/${session.projectId}/sessions/${session.id}`
                    : `/dashboard/sessions/${session.id}`
                }
                key={session.id}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        STATUS_COLORS[session.status] ?? "bg-zinc-500"
                      } ${session.status === "active" ? "animate-pulse" : ""}`}
                    />
                    <Badge
                      className="text-[10px] capitalize"
                      variant={
                        session.status === "active" ? "success" : "outline"
                      }
                    >
                      {session.status}
                    </Badge>
                  </div>
                  <span className="font-mono text-[10px] text-zinc-600">
                    {session.id.slice(0, 12)}
                  </span>
                </div>
                <div className="mt-2 font-medium text-sm text-zinc-200 group-hover:text-zinc-100">
                  {(session.project as { name?: string } | null)?.name ||
                    "Untitled Session"}
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
          <h2 className="font-semibold text-lg text-zinc-200">
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
            <ProjectCardSkeleton />
          </div>
        )}
        {!projectsQuery.isLoading && projects.length === 0 && (
          <Card className="border-zinc-800 border-dashed bg-zinc-900/30 p-12 text-center">
            <CardContent className="p-0">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
                <FolderOpen className="h-6 w-6 text-zinc-500" />
              </div>
              <p className="mt-4 text-sm text-zinc-400">No projects yet</p>
              <p className="mt-1 text-xs text-zinc-600">
                Create your first project to get started.
              </p>
              <Button asChild className="mt-4">
                <Link href="/dashboard/projects/new">Create Project</Link>
              </Button>
            </CardContent>
          </Card>
        )}
        {!projectsQuery.isLoading && projects.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Link
                className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700 hover:bg-zinc-900"
                href={`/dashboard/projects/${project.id}` as Route}
                key={project.id}
              >
                <div className="flex items-center justify-between">
                  <Badge
                    className="text-[10px]"
                    variant={
                      project.status === "active" ? "success" : "outline"
                    }
                  >
                    {project.status}
                  </Badge>
                  {project.techStackPreset && (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                      {project.techStackPreset}
                    </span>
                  )}
                </div>
                <h3 className="mt-3 font-semibold text-sm text-zinc-200 group-hover:text-zinc-100">
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
        <h2 className="mb-4 font-semibold text-lg text-zinc-200">
          Recent Activity
        </h2>
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="p-0">
            {recentActivity.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">
                No recent activity. Start a task to see updates here.
              </div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {recentActivity.slice(0, 10).map((activity) => (
                  <div
                    className="flex items-center gap-3 px-4 py-3"
                    key={activity.id}
                  >
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
