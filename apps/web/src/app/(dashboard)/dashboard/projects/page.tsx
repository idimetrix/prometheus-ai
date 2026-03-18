"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

const STATUS_BADGES: Record<string, { color: string; label: string }> = {
  active: { color: "bg-green-500/10 text-green-400", label: "Active" },
  setup: { color: "bg-yellow-500/10 text-yellow-400", label: "Setup" },
  archived: { color: "bg-zinc-500/10 text-zinc-400", label: "Archived" },
};

export default function ProjectsPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(
    undefined
  );

  const projectsQuery = trpc.projects.list.useQuery(
    {
      limit: 50,
      status: statusFilter as "active" | "archived" | "setup" | undefined,
    },
    { retry: false }
  );
  const deleteMutation = trpc.projects.delete.useMutation();

  const projects = projectsQuery.data?.projects ?? [];

  async function handleArchive(projectId: string) {
    // biome-ignore lint/suspicious/noAlert: TODO replace with dialog component
    if (!confirm("Archive this project?")) {
      return;
    }
    await deleteMutation.mutateAsync({ projectId });
    projectsQuery.refetch();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-zinc-100">Projects</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Manage your engineering projects.
          </p>
        </div>
        <Link
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white hover:bg-violet-700"
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
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {[
          { value: undefined, label: "All" },
          { value: "active", label: "Active" },
          { value: "setup", label: "Setup" },
          { value: "archived", label: "Archived" },
        ].map((filter) => (
          <button
            className={`rounded-lg px-3 py-1.5 font-medium text-xs transition-colors ${
              statusFilter === filter.value
                ? "bg-violet-600 text-white"
                : "border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
            key={filter.label}
            onClick={() => setStatusFilter(filter.value)}
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Project grid */}
      {projects.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 border-dashed bg-zinc-900/30 p-12 text-center">
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
                d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
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
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const badge = STATUS_BADGES[project.status] ?? STATUS_BADGES.active;
            return (
              <div
                className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700"
                key={project.id}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${badge?.color}`}
                  >
                    {badge?.label}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Link
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                      href={`/dashboard/projects/${project.id}/brain` as Route}
                      title="Project Brain"
                    >
                      <svg
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </Link>
                    <button
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                      onClick={() => handleArchive(project.id)}
                      title="Archive"
                      type="button"
                    >
                      <svg
                        aria-hidden="true"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                <h3 className="mt-3 font-semibold text-sm text-zinc-200">
                  {project.name}
                </h3>
                {project.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">
                    {project.description}
                  </p>
                )}

                <div className="mt-4 flex items-center gap-3 text-[10px] text-zinc-600">
                  {project.techStackPreset && (
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5">
                      {project.techStackPreset}
                    </span>
                  )}
                  <span>
                    Created {new Date(project.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div className="mt-3 flex gap-2">
                  <Link
                    className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 text-center text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    href={`/dashboard/projects/${project.id}/brain` as Route}
                  >
                    Brain
                  </Link>
                  <Link
                    className="flex-1 rounded-lg bg-violet-600/10 py-1.5 text-center text-violet-400 text-xs hover:bg-violet-600/20"
                    href={`/new?projectId=${project.id}`}
                  >
                    New Task
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
