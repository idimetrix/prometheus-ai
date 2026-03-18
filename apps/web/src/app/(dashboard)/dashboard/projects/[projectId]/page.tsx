"use client";

import { use } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500/10 text-green-400",
  paused: "bg-yellow-500/10 text-yellow-400",
  completed: "bg-blue-500/10 text-blue-400",
  failed: "bg-red-500/10 text-red-400",
  cancelled: "bg-zinc-800 text-zinc-400",
};

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const projectQuery = trpc.projects.get.useQuery({ projectId });
  const sessionsQuery = trpc.sessions.list.useQuery({ projectId, limit: 20 });

  const project = projectQuery.data;
  const sessions = sessionsQuery.data?.sessions ?? [];

  if (projectQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex h-64 items-center justify-center text-zinc-500">
        Project not found
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-zinc-100">{project.name}</h1>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[project.status] ?? "bg-zinc-800 text-zinc-400"}`}>
              {project.status}
            </span>
          </div>
          {project.description && (
            <p className="mt-1 text-sm text-zinc-500">{project.description}</p>
          )}
          {project.repoUrl && (
            <p className="mt-1 font-mono text-xs text-zinc-600">{project.repoUrl}</p>
          )}
        </div>
        <div className="flex gap-3">
          <Link
            href={`/dashboard/projects/${projectId}/brain`}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800"
          >
            Project Brain
          </Link>
          <Link
            href="/new"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            New Task
          </Link>
        </div>
      </div>

      {/* Project Settings Summary */}
      {project.settings && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <span className="text-xs text-zinc-500">Agent Mode</span>
            <p className="mt-1 text-sm font-medium text-zinc-200 capitalize">
              {project.settings.agentAggressiveness?.replace("_", " ")}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <span className="text-xs text-zinc-500">CI Loop Max</span>
            <p className="mt-1 text-sm font-medium text-zinc-200">
              {project.settings.ciLoopMaxIterations} iterations
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <span className="text-xs text-zinc-500">Test Coverage Target</span>
            <p className="mt-1 text-sm font-medium text-zinc-200">
              {project.settings.testCoverageTarget}%
            </p>
          </div>
        </div>
      )}

      {/* Sessions */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-200">Sessions</h2>
        <div className="mt-4 space-y-2">
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-500">
              No sessions yet. Create a task to get started.
            </div>
          ) : (
            sessions.map((session: any) => (
              <Link
                key={session.id}
                href={`/dashboard/sessions/${session.id}`}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 transition-colors hover:border-zinc-700"
              >
                <div className="flex items-center gap-3">
                  <span className={`h-2 w-2 rounded-full ${
                    session.status === "active" ? "bg-green-500 animate-pulse"
                    : session.status === "paused" ? "bg-yellow-500"
                    : session.status === "completed" ? "bg-blue-500"
                    : session.status === "failed" ? "bg-red-500"
                    : "bg-zinc-600"
                  }`} />
                  <div>
                    <span className="text-sm font-medium text-zinc-200">
                      {session.mode} session
                    </span>
                    <span className="ml-2 font-mono text-xs text-zinc-500">
                      {session.id}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[session.status] ?? ""}`}>
                    {session.status}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {new Date(session.startedAt).toLocaleDateString()}
                  </span>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
