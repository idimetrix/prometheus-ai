"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc";

const STATUS_BADGES: Record<string, { color: string; label: string }> = {
  active: { color: "bg-green-500/10 text-green-400", label: "Active" },
  setup: { color: "bg-yellow-500/10 text-yellow-400", label: "Setup" },
  archived: { color: "bg-zinc-500/10 text-zinc-400", label: "Archived" },
};

export default function ProjectsPage() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);

  const projectsQuery = trpc.projects.list.useQuery(
    { limit: 50, status: statusFilter as "active" | "archived" | "setup" | undefined },
    { retry: false },
  );
  const deleteMutation = trpc.projects.delete.useMutation();

  const projects = projectsQuery.data?.projects ?? [];

  async function handleArchive(projectId: string) {
    if (!confirm("Archive this project?")) return;
    await deleteMutation.mutateAsync({ projectId });
    projectsQuery.refetch();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Projects</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Manage your engineering projects.
          </p>
        </div>
        <Link
          href="/dashboard/projects/new"
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
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
            key={filter.label}
            onClick={() => setStatusFilter(filter.value)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === filter.value
                ? "bg-violet-600 text-white"
                : "border border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Project grid */}
      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-12 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
            <svg className="h-6 w-6 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
            </svg>
          </div>
          <p className="mt-4 text-sm text-zinc-400">No projects yet</p>
          <p className="mt-1 text-xs text-zinc-600">
            Create your first project to get started.
          </p>
          <Link
            href="/dashboard/projects/new"
            className="mt-4 inline-flex items-center rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700"
          >
            Create Project
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const badge =
              STATUS_BADGES[project.status] ?? STATUS_BADGES.active;
            return (
              <div
                key={project.id}
                className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition-colors hover:border-zinc-700"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${badge?.color}`}
                  >
                    {badge?.label}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Link
                      href={`/dashboard/projects/${project.id}/brain`}
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                      title="Project Brain"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
                      </svg>
                    </Link>
                    <button
                      onClick={() => handleArchive(project.id)}
                      className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                      title="Archive"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
                      </svg>
                    </button>
                  </div>
                </div>

                <h3 className="mt-3 text-sm font-semibold text-zinc-200">
                  {project.name}
                </h3>
                {project.description && (
                  <p className="mt-1 text-xs text-zinc-500 line-clamp-2">
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
                    href={`/dashboard/projects/${project.id}/brain`}
                    className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 py-1.5 text-center text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                  >
                    Brain
                  </Link>
                  <Link
                    href={`/new?projectId=${project.id}`}
                    className="flex-1 rounded-lg bg-violet-600/10 py-1.5 text-center text-xs text-violet-400 hover:bg-violet-600/20"
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
