"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

type OnboardingStep = "org" | "repo" | "preset" | "first-task";

const STEPS: { key: OnboardingStep; title: string; description: string }[] = [
  {
    key: "org",
    title: "Create Organization",
    description: "Set up your team workspace",
  },
  {
    key: "repo",
    title: "Connect Repository",
    description: "Link your GitHub or GitLab repo",
  },
  {
    key: "preset",
    title: "Select Preset",
    description: "Choose your tech stack",
  },
  {
    key: "first-task",
    title: "Run First Task",
    description: "See AI agents in action",
  },
];

const PRESETS = [
  {
    id: "nextjs",
    name: "Next.js + tRPC",
    description: "Full-stack TypeScript",
    icon: "N",
  },
  {
    id: "django-react",
    name: "Django + React",
    description: "Python backend, React frontend",
    icon: "D",
  },
  {
    id: "rails",
    name: "Ruby on Rails",
    description: "Convention over configuration",
    icon: "R",
  },
  {
    id: "go-htmx",
    name: "Go + HTMX",
    description: "Lightweight and fast",
    icon: "G",
  },
  {
    id: "flutter",
    name: "Flutter",
    description: "Cross-platform mobile",
    icon: "F",
  },
  {
    id: "rust-axum",
    name: "Rust + Axum",
    description: "Performance-first backend",
    icon: "Rs",
  },
];

const EXAMPLE_TASKS = [
  "Add a user profile page with avatar upload",
  "Create a REST API for todo items with CRUD",
  "Set up authentication with email/password and OAuth",
  "Build a dashboard with analytics charts",
];

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("org");
  const [orgName, setOrgName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [taskInput, setTaskInput] = useState("");

  const currentIdx = STEPS.findIndex((s) => s.key === currentStep);

  const handleNext = useCallback(() => {
    const nextIdx = currentIdx + 1;
    if (nextIdx < STEPS.length) {
      const nextStep = STEPS[nextIdx];
      if (nextStep) {
        setCurrentStep(nextStep.key);
      }
    }
  }, [currentIdx]);

  const handleBack = useCallback(() => {
    const prevIdx = currentIdx - 1;
    if (prevIdx >= 0) {
      const prevStep = STEPS[prevIdx];
      if (prevStep) {
        setCurrentStep(prevStep.key);
      }
    }
  }, [currentIdx]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-2 font-bold text-3xl text-white">
        Welcome to Prometheus
      </h1>
      <p className="mb-8 text-zinc-400">
        Let&apos;s get you set up in 4 quick steps.
      </p>

      {/* Progress bar */}
      <div className="mb-8 flex gap-2">
        {STEPS.map((step, idx) => (
          <div className="flex-1" key={step.key}>
            <div
              className={`h-1.5 rounded-full ${idx <= currentIdx ? "bg-indigo-500" : "bg-zinc-700"}`}
            />
            <div
              className={`mt-2 text-xs ${idx <= currentIdx ? "text-indigo-400" : "text-zinc-600"}`}
            >
              {step.title}
            </div>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        {currentStep === "org" && (
          <div>
            <h2 className="mb-4 font-semibold text-white text-xl">
              Create Your Organization
            </h2>
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Organization name"
              value={orgName}
            />
          </div>
        )}

        {currentStep === "repo" && (
          <div>
            <h2 className="mb-4 font-semibold text-white text-xl">
              Connect Your Repository
            </h2>
            <div className="space-y-3">
              <button
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-700 p-4 text-left hover:border-zinc-500"
                type="button"
              >
                <span className="text-2xl">GH</span>
                <div>
                  <div className="font-medium text-white">GitHub</div>
                  <div className="text-sm text-zinc-400">Connect via OAuth</div>
                </div>
              </button>
              <button
                className="flex w-full items-center gap-3 rounded-lg border border-zinc-700 p-4 text-left hover:border-zinc-500"
                type="button"
              >
                <span className="text-2xl">GL</span>
                <div>
                  <div className="font-medium text-white">GitLab</div>
                  <div className="text-sm text-zinc-400">Connect via OAuth</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {currentStep === "preset" && (
          <div>
            <h2 className="mb-4 font-semibold text-white text-xl">
              Choose Your Tech Stack
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {PRESETS.map((preset) => (
                <button
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    selectedPreset === preset.id
                      ? "border-indigo-500 bg-indigo-600/10"
                      : "border-zinc-700 hover:border-zinc-500"
                  }`}
                  key={preset.id}
                  onClick={() => setSelectedPreset(preset.id)}
                  type="button"
                >
                  <div className="mb-1 font-bold text-lg text-white">
                    {preset.icon}
                  </div>
                  <div className="font-medium text-white">{preset.name}</div>
                  <div className="text-xs text-zinc-400">
                    {preset.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {currentStep === "first-task" && (
          <div>
            <h2 className="mb-4 font-semibold text-white text-xl">
              Run Your First Task
            </h2>
            <textarea
              className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              onChange={(e) => setTaskInput(e.target.value)}
              placeholder="Describe what you want to build..."
              rows={3}
              value={taskInput}
            />
            <div className="mb-4">
              <div className="mb-2 text-xs text-zinc-500">
                Or try one of these:
              </div>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_TASKS.map((task) => (
                  <button
                    className="rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-indigo-500 hover:text-indigo-400"
                    key={task}
                    onClick={() => setTaskInput(task)}
                    type="button"
                  >
                    {task}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <button
            className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white disabled:invisible"
            disabled={currentIdx === 0}
            onClick={handleBack}
            type="button"
          >
            Back
          </button>

          {currentStep === "first-task" ? (
            <Link
              className="rounded-lg bg-indigo-600 px-6 py-2 font-medium text-sm text-white hover:bg-indigo-500"
              href="/dashboard"
            >
              Launch
            </Link>
          ) : (
            <button
              className="rounded-lg bg-indigo-600 px-6 py-2 font-medium text-sm text-white hover:bg-indigo-500"
              onClick={handleNext}
              type="button"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
