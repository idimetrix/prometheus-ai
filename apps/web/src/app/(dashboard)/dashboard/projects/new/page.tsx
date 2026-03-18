"use client";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

const PRESETS = [
  {
    id: "modern-saas",
    name: "Modern SaaS",
    desc: "Next.js + tRPC + Drizzle + PostgreSQL",
  },
  {
    id: "fullstack-minimal",
    name: "Full-Stack Minimal",
    desc: "Next.js + Prisma + SQLite",
  },
  {
    id: "django-react",
    name: "Django + React",
    desc: "Django REST + React SPA",
  },
  { id: "rails", name: "Rails + Hotwire", desc: "Ruby on Rails full-stack" },
  {
    id: "go-microservices",
    name: "Go Microservices",
    desc: "Go + gRPC + PostgreSQL",
  },
  {
    id: "laravel-vue",
    name: "Laravel + Vue",
    desc: "Laravel API + Vue.js frontend",
  },
  {
    id: "react-native",
    name: "React Native",
    desc: "Expo + React Native mobile",
  },
  {
    id: "rust-backend",
    name: "Rust Backend",
    desc: "Axum + SQLx + PostgreSQL",
  },
  { id: "custom", name: "Custom", desc: "Define your own tech stack" },
];

export default function NewProjectPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const createMutation = trpc.projects.create.useMutation();

  async function handleCreate() {
    if (!(name.trim() && preset)) {
      return;
    }
    setIsCreating(true);
    try {
      const project = await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        techStackPreset: preset,
        repoUrl: repoUrl.trim() || undefined,
      });
      router.push(`/dashboard/projects/${project?.id}/brain` as Route);
    } catch (err) {
      console.error("Failed to create project:", err);
      setIsCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-bold text-2xl text-zinc-100">Create New Project</h1>
        <div className="mt-3 flex items-center gap-3">
          {[1, 2, 3].map((s) => (
            <div className="flex items-center gap-2" key={s}>
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full font-medium text-xs ${
                  step >= s
                    ? "bg-violet-600 text-white"
                    : "border border-zinc-700 text-zinc-500"
                }`}
              >
                {s}
              </div>
              <span
                className={`text-xs ${
                  step >= s ? "font-medium text-zinc-200" : "text-zinc-500"
                }`}
              >
                {
                  (
                    { 1: "Details", 2: "Tech Stack", 3: "Confirm" } as Record<
                      number,
                      string
                    >
                  )[s]
                }
              </span>
              {s < 3 && <div className="mx-1 h-px w-8 bg-zinc-800" />}
            </div>
          ))}
        </div>
      </div>

      {step === 1 && (
        <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div>
            <label
              className="font-medium text-sm text-zinc-300"
              htmlFor="project-name"
            >
              Project Name
            </label>
            <input
              className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              id="project-name"
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome SaaS"
              type="text"
              value={name}
            />
          </div>
          <div>
            <label
              className="font-medium text-sm text-zinc-300"
              htmlFor="project-description"
            >
              Description
            </label>
            <textarea
              className="mt-1.5 w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              id="project-description"
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you want to build..."
              rows={4}
              value={description}
            />
          </div>
          <div>
            <label
              className="font-medium text-sm text-zinc-300"
              htmlFor="project-repo-url"
            >
              Repository URL{" "}
              <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <input
              className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              id="project-repo-url"
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
              type="text"
              value={repoUrl}
            />
          </div>
          <div className="flex justify-end">
            <button
              className="rounded-lg bg-violet-600 px-6 py-2 font-medium text-sm text-white hover:bg-violet-700 disabled:opacity-50"
              disabled={!name.trim()}
              onClick={() => setStep(2)}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            {PRESETS.map((p) => (
              <button
                className={`rounded-xl border p-4 text-left transition-all ${
                  preset === p.id
                    ? "border-violet-500 bg-violet-500/10 ring-1 ring-violet-500/30"
                    : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700"
                }`}
                key={p.id}
                onClick={() => setPreset(p.id)}
                type="button"
              >
                <div className="font-medium text-sm text-zinc-200">
                  {p.name}
                </div>
                <div className="mt-1 text-xs text-zinc-500">{p.desc}</div>
              </button>
            ))}
          </div>
          <div className="flex justify-between">
            <button
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              onClick={() => setStep(1)}
              type="button"
            >
              Back
            </button>
            <button
              className="rounded-lg bg-violet-600 px-6 py-2 font-medium text-sm text-white hover:bg-violet-700 disabled:opacity-50"
              disabled={!preset}
              onClick={() => setStep(3)}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h3 className="font-semibold text-sm text-zinc-200">Summary</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs text-zinc-500">Name</div>
                <div className="mt-0.5 font-medium text-sm text-zinc-200">
                  {name}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Tech Stack</div>
                <div className="mt-0.5 font-medium text-sm text-zinc-200">
                  {PRESETS.find((p) => p.id === preset)?.name}
                </div>
              </div>
              {description && (
                <div className="md:col-span-2">
                  <div className="text-xs text-zinc-500">Description</div>
                  <div className="mt-0.5 text-sm text-zinc-300">
                    {description}
                  </div>
                </div>
              )}
              {repoUrl && (
                <div className="md:col-span-2">
                  <div className="text-xs text-zinc-500">Repository</div>
                  <div className="mt-0.5 font-mono text-sm text-zinc-300">
                    {repoUrl}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-between">
            <button
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              onClick={() => setStep(2)}
              type="button"
            >
              Back
            </button>
            <button
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-6 py-2 font-medium text-sm text-white hover:bg-violet-700 disabled:opacity-50"
              disabled={isCreating}
              onClick={handleCreate}
              type="button"
            >
              {isCreating ? (
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
                  Creating...
                </>
              ) : (
                "Create Project"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
