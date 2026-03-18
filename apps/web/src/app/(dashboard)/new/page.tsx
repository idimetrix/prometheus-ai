"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";

const MODES = [
  {
    id: "task" as const,
    label: "Task",
    desc: "Execute a specific coding task",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
      </svg>
    ),
  },
  {
    id: "plan" as const,
    label: "Plan",
    desc: "Generate a detailed plan without executing",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
      </svg>
    ),
  },
  {
    id: "ask" as const,
    label: "Ask",
    desc: "Ask questions about your codebase",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
      </svg>
    ),
  },
  {
    id: "watch" as const,
    label: "Watch",
    desc: "Monitor and auto-fix CI/CD failures",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    ),
  },
  {
    id: "fleet" as const,
    label: "Fleet",
    desc: "Deploy multiple agents in parallel",
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Z" />
      </svg>
    ),
  },
];

const CREDIT_ESTIMATES: Record<string, number> = {
  task: 5,
  plan: 2,
  ask: 1,
  watch: 3,
  fleet: 15,
};

export default function NewTaskPage() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"task" | "plan" | "ask" | "watch" | "fleet">("task");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const projectsQuery = trpc.projects.list.useQuery(
    { limit: 50 },
    { retry: false },
  );
  const createSession = trpc.sessions.create.useMutation();

  const projects = projectsQuery.data?.projects ?? [];
  const estimatedCredits = CREDIT_ESTIMATES[mode] ?? 5;

  async function handleSubmit() {
    if (!prompt.trim() || !selectedProjectId) return;
    setIsSubmitting(true);
    try {
      const session = await createSession.mutateAsync({
        projectId: selectedProjectId,
        prompt: prompt.trim(),
        mode,
      });
      router.push(`/dashboard/sessions/${session.id}`);
    } catch (err) {
      console.error("Failed to create session:", err);
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">New Task</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Describe what you want to build, fix, or explore.
        </p>
      </div>

      {/* Mode selection */}
      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-300">
          Mode
        </label>
        <div className="grid grid-cols-5 gap-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all ${
                mode === m.id
                  ? "border-violet-500 bg-violet-500/10 text-violet-400"
                  : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300"
              }`}
            >
              {m.icon}
              <span className="text-xs font-medium">{m.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {MODES.find((m) => m.id === mode)?.desc}
        </p>
      </div>

      {/* Project selector */}
      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-300">
          Project
        </label>
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
        >
          <option value="">Select a project...</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        {projects.length === 0 && !projectsQuery.isLoading && (
          <p className="mt-1.5 text-xs text-zinc-500">
            No projects yet.{" "}
            <a
              href="/dashboard/projects/new"
              className="text-violet-400 hover:text-violet-300"
            >
              Create one first
            </a>
          </p>
        )}
      </div>

      {/* Prompt textarea */}
      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-300">
          Prompt
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            mode === "ask"
              ? "What would you like to know about this codebase?"
              : mode === "plan"
                ? "Describe what you want to plan..."
                : mode === "watch"
                  ? "Describe what to monitor..."
                  : "Describe what you want to build or fix..."
          }
          rows={8}
          className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
          <span>{prompt.length} characters</span>
          <span>
            Tip: Be specific about requirements, constraints, and desired
            outcomes
          </span>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <svg className="h-4 w-4 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10.75 10.818a2.608 2.608 0 0 1-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 0 1-1.279-.2 2.349 2.349 0 0 1-.96-.609 2.372 2.372 0 0 1-.535-.858A3.2 3.2 0 0 1 4.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 0 1 1.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766ZM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
            </svg>
            <span className="text-sm text-zinc-300">
              ~{estimatedCredits} credits
            </span>
            <span className="text-xs text-zinc-500">estimated</span>
          </div>
        </div>
        <button
          onClick={handleSubmit}
          disabled={!prompt.trim() || !selectedProjectId || isSubmitting}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Submitting...
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
              </svg>
              Submit Task
            </>
          )}
        </button>
      </div>
    </div>
  );
}
