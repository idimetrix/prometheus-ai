"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CostEstimator } from "./cost-estimator";

type Mode = "task" | "plan" | "ask" | "watch" | "fleet";

const MODES: Array<{ id: Mode; label: string; desc: string }> = [
  { id: "task", label: "Task", desc: "Execute a specific coding task" },
  { id: "ask", label: "Ask", desc: "Ask questions about your codebase" },
  {
    id: "plan",
    label: "Plan",
    desc: "Generate a detailed plan without executing",
  },
  { id: "watch", label: "Watch", desc: "Monitor and auto-fix CI/CD failures" },
  { id: "fleet", label: "Fleet", desc: "Deploy multiple agents in parallel" },
];

interface SubmitFormProps {
  defaultMode?: Mode;
  defaultProjectId?: string;
}

export function TaskSubmitForm({
  defaultProjectId,
  defaultMode,
}: SubmitFormProps) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<Mode>(defaultMode ?? "task");
  const [selectedProjectId, setSelectedProjectId] = useState(
    defaultProjectId ?? ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const projectsQuery = trpc.projects.list.useQuery(
    { limit: 50 },
    { retry: false }
  );
  const createSession = trpc.sessions.create.useMutation();

  const projects = projectsQuery.data?.projects ?? [];

  // Auto-select first project if only one available
  useEffect(() => {
    if (projects.length === 1 && !selectedProjectId) {
      setSelectedProjectId(projects[0]?.id ?? "");
    }
  }, [projects, selectedProjectId]);

  const handleSubmit = useCallback(async () => {
    if (!(prompt.trim() && selectedProjectId)) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const session = await createSession.mutateAsync({
        projectId: selectedProjectId,
        prompt: prompt.trim(),
        mode,
      });
      router.push(`/dashboard/sessions/${session?.id}`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to create session";
      setError(message);
      setIsSubmitting(false);
    }
  }, [prompt, selectedProjectId, mode, createSession, router]);

  // Cmd+Enter keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSubmit]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Mode selector */}
      <div>
        <span className="mb-2 block font-medium text-sm text-zinc-300">
          Mode
        </span>
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button
              className={`rounded-lg border px-4 py-2 font-medium text-sm transition-all ${
                mode === m.id
                  ? "border-violet-500 bg-violet-500/10 text-violet-400"
                  : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300"
              }`}
              key={m.id}
              onClick={() => setMode(m.id)}
              type="button"
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {MODES.find((m) => m.id === mode)?.desc}
        </p>
      </div>

      {/* Project selector */}
      {projects.length > 0 && (
        <div>
          <label
            className="mb-2 block font-medium text-sm text-zinc-300"
            htmlFor="task-project-select"
          >
            Project
          </label>
          <select
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
            id="task-project-select"
            onChange={(e) => setSelectedProjectId(e.target.value)}
            value={selectedProjectId}
          >
            <option value="">Select a project...</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {projects.length === 0 && !projectsQuery.isLoading && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4 text-center">
          <p className="text-sm text-zinc-400">No projects found.</p>
          <a
            className="mt-1 inline-block text-violet-400 text-xs hover:text-violet-300"
            href="/dashboard/projects/new"
          >
            Create a project first
          </a>
        </div>
      )}

      {/* Prompt textarea */}
      <div>
        <label
          className="mb-2 block font-medium text-sm text-zinc-300"
          htmlFor="task-prompt"
        >
          Describe your task
        </label>
        <textarea
          className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-200 leading-relaxed outline-none placeholder:text-zinc-600 focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          id="task-prompt"
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={(() => {
            if (mode === "ask") {
              return "What would you like to know about this codebase?";
            }
            if (mode === "plan") {
              return "Describe what you want to plan...";
            }
            if (mode === "watch") {
              return "Describe what to monitor...";
            }
            return "Describe what you want to build or fix...";
          })()}
          rows={8}
          value={prompt}
        />
        <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
          <span>{prompt.length} characters</span>
          <span className="hidden sm:inline">
            Press{" "}
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 font-mono text-[10px]">
              {"\u2318"}+Enter
            </kbd>{" "}
            to submit
          </span>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Bottom bar: cost estimate + submit */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <CostEstimator descriptionLength={prompt.length} mode={mode} />

        <button
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-2.5 font-medium text-sm text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!(prompt.trim() && selectedProjectId) || isSubmitting}
          onClick={handleSubmit}
          type="button"
        >
          {isSubmitting ? (
            <>
              <svg
                aria-hidden="true"
                className="h-4 w-4 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  fill="currentColor"
                />
              </svg>
              Submitting...
            </>
          ) : (
            <>
              <svg
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Submit
            </>
          )}
        </button>
      </div>
    </div>
  );
}
