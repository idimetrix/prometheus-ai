"use client";

import type { Route } from "next";
import Link from "next/link";
import { use } from "react";
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
            <h1 className="font-bold text-2xl text-zinc-100">{project.name}</h1>
            <span
              className={`rounded-full px-2.5 py-0.5 font-medium text-xs ${STATUS_COLORS[project.status] ?? "bg-zinc-800 text-zinc-400"}`}
            >
              {project.status}
            </span>
          </div>
          {project.description && (
            <p className="mt-1 text-sm text-zinc-500">{project.description}</p>
          )}
          {project.repoUrl && (
            <p className="mt-1 font-mono text-xs text-zinc-600">
              {project.repoUrl}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <Link
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 font-medium text-sm text-zinc-300 hover:bg-zinc-800"
            href={`/dashboard/projects/${projectId}/brain` as Route}
          >
            Project Brain
          </Link>
          <Link
            className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white hover:bg-violet-700"
            href="/new"
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
            <p className="mt-1 font-medium text-sm text-zinc-200 capitalize">
              {project.settings.agentAggressiveness?.replace("_", " ")}
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <span className="text-xs text-zinc-500">CI Loop Max</span>
            <p className="mt-1 font-medium text-sm text-zinc-200">
              {project.settings.ciLoopMaxIterations} iterations
            </p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
            <span className="text-xs text-zinc-500">Test Coverage Target</span>
            <p className="mt-1 font-medium text-sm text-zinc-200">
              {project.settings.testCoverageTarget}%
            </p>
          </div>
        </div>
      )}

      {/* Sessions */}
      <div>
        <h2 className="font-semibold text-lg text-zinc-200">Sessions</h2>
        <div className="mt-4 space-y-2">
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-500">
              No sessions yet. Create a task to get started.
            </div>
          ) : (
            sessions.map((session) => (
              <Link
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/30 p-4 transition-colors hover:border-zinc-700"
                href={`/dashboard/sessions/${session.id}` as Route}
                key={session.id}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      (
                        {
                          active: "animate-pulse bg-green-500",
                          paused: "bg-yellow-500",
                          completed: "bg-blue-500",
                          failed: "bg-red-500",
                        } as Record<string, string>
                      )[session.status as string] ?? "bg-zinc-600"
                    }`}
                  />
                  <div>
                    <span className="font-medium text-sm text-zinc-200">
                      {session.mode} session
                    </span>
                    <span className="ml-2 font-mono text-xs text-zinc-500">
                      {session.id}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${STATUS_COLORS[session.status] ?? ""}`}
                  >
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
