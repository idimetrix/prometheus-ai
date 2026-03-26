"use client";

import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

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

const ONBOARDING_COMPLETE_KEY = "prometheus:onboarding-complete";

export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("org");
  const [orgName, setOrgName] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [taskInput, setTaskInput] = useState("");
  const [repoConnected, setRepoConnected] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);

  const searchParams = useSearchParams();
  const currentIdx = STEPS.findIndex((s) => s.key === currentStep);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [_isCreatingOrg, setIsCreatingOrg] = useState(false);

  // Handle OAuth callback return
  useEffect(() => {
    const provider = searchParams.get("provider");
    const connected = searchParams.get("connected");
    if (provider && connected === "true") {
      setRepoConnected(provider.charAt(0).toUpperCase() + provider.slice(1));
      setCurrentStep("repo");
      toast.success(`${provider} connected successfully!`);
    }
  }, [searchParams]);

  const createOrg = trpc.user.createOrg.useMutation({
    onError(error) {
      toast.error(`Failed to create organization: ${error.message}`);
      setIsCreatingOrg(false);
    },
  });

  const createProject = trpc.projects.create.useMutation({
    onError(error) {
      toast.error(`Failed to create project: ${error.message}`);
    },
  });

  const createSession = trpc.sessions.create.useMutation({
    onError(error) {
      toast.error(`Failed to create session: ${error.message}`);
    },
  });

  const handleNext = useCallback(async () => {
    // Validate current step before proceeding
    if (currentStep === "org" && !orgName.trim()) {
      toast.error("Please enter an organization name");
      return;
    }

    // Create the org when leaving the org step
    if (currentStep === "org" && !orgId) {
      setIsCreatingOrg(true);
      try {
        const org = await createOrg.mutateAsync({ name: orgName.trim() });
        setOrgId(org.id);
        toast.success("Organization created!");
      } catch {
        // Error handled by mutation callback
        return;
      } finally {
        setIsCreatingOrg(false);
      }
    }

    const nextIdx = currentIdx + 1;
    if (nextIdx < STEPS.length) {
      const nextStep = STEPS[nextIdx];
      if (nextStep) {
        setCurrentStep(nextStep.key);
      }
    }
  }, [currentIdx, currentStep, orgName, orgId, createOrg]);

  const handleBack = useCallback(() => {
    const prevIdx = currentIdx - 1;
    if (prevIdx >= 0) {
      const prevStep = STEPS[prevIdx];
      if (prevStep) {
        setCurrentStep(prevStep.key);
      }
    }
  }, [currentIdx]);

  const handleConnectRepo = useCallback(
    (provider: string) => {
      if (!orgId) {
        toast.error("Please create an organization first");
        return;
      }
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
      const providerSlug = provider.toLowerCase();
      // Redirect to real OAuth flow with orgId in state
      window.location.href = `${apiUrl}/oauth/${providerSlug}/authorize?orgId=${orgId}&returnTo=${encodeURIComponent(window.location.href)}`;
    },
    [orgId]
  );

  const handleSkip = useCallback(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
    }
    router.push("/dashboard");
  }, [router]);

  const handleLaunch = useCallback(async () => {
    if (!taskInput.trim()) {
      toast.error("Please describe a task or select an example");
      return;
    }

    setIsLaunching(true);
    try {
      const project = await createProject.mutateAsync({
        name: orgName.trim() || "My First Project",
        techStackPreset: selectedPreset || undefined,
        description: taskInput.trim(),
      });

      const session = await createSession.mutateAsync({
        projectId: project.id,
        prompt: taskInput.trim(),
        mode: "task",
      });

      // Mark onboarding as complete
      if (typeof window !== "undefined") {
        localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
      }

      toast.success("Project created! Redirecting to your session...");
      router.push(`/dashboard/sessions/${session.id}` as Route);
    } catch {
      // Errors are handled by mutation onError callbacks
      setIsLaunching(false);
    }
  }, [
    taskInput,
    orgName,
    selectedPreset,
    createProject,
    createSession,
    router,
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="mb-2 font-bold text-3xl text-white">
            Welcome to Prometheus
          </h1>
          <p className="text-zinc-400">
            Let&apos;s get you set up in 4 quick steps.
          </p>
        </div>
        <button
          className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 transition-colors hover:border-zinc-500 hover:text-white"
          onClick={handleSkip}
          type="button"
        >
          Skip
        </button>
      </div>

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
            <label className="sr-only" htmlFor="org-name">
              Organization name
            </label>
            <input
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              id="org-name"
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
                className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                  repoConnected === "GitHub"
                    ? "border-green-500 bg-green-600/10"
                    : "border-zinc-700 hover:border-zinc-500"
                }`}
                onClick={() => handleConnectRepo("GitHub")}
                type="button"
              >
                <span className="text-2xl">GH</span>
                <div className="flex-1">
                  <div className="font-medium text-white">GitHub</div>
                  <div className="text-sm text-zinc-400">Connect via OAuth</div>
                </div>
                {repoConnected === "GitHub" && (
                  <span className="text-green-400 text-sm">Connected</span>
                )}
              </button>
              <button
                className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                  repoConnected === "GitLab"
                    ? "border-green-500 bg-green-600/10"
                    : "border-zinc-700 hover:border-zinc-500"
                }`}
                onClick={() => handleConnectRepo("GitLab")}
                type="button"
              >
                <span className="text-2xl">GL</span>
                <div className="flex-1">
                  <div className="font-medium text-white">GitLab</div>
                  <div className="text-sm text-zinc-400">Connect via OAuth</div>
                </div>
                {repoConnected === "GitLab" && (
                  <span className="text-green-400 text-sm">Connected</span>
                )}
              </button>
              <button
                className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                  repoConnected === "Bitbucket"
                    ? "border-green-500 bg-green-600/10"
                    : "border-zinc-700 hover:border-zinc-500"
                }`}
                onClick={() => handleConnectRepo("Bitbucket")}
                type="button"
              >
                <span className="text-2xl">BB</span>
                <div className="flex-1">
                  <div className="font-medium text-white">Bitbucket</div>
                  <div className="text-sm text-zinc-400">Connect via OAuth</div>
                </div>
                {repoConnected === "Bitbucket" && (
                  <span className="text-green-400 text-sm">Connected</span>
                )}
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
            <label className="sr-only" htmlFor="first-task-input">
              Task description
            </label>
            <textarea
              aria-label="Task description"
              className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              id="first-task-input"
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
                    className="min-h-[44px] rounded-full border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-indigo-500 hover:text-indigo-400"
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
            className="min-h-[44px] rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white disabled:invisible"
            disabled={currentIdx === 0}
            onClick={handleBack}
            type="button"
          >
            Back
          </button>

          {currentStep === "first-task" ? (
            <button
              className="min-h-[44px] rounded-lg bg-indigo-600 px-6 py-2 font-medium text-sm text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isLaunching}
              onClick={handleLaunch}
              type="button"
            >
              {isLaunching ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Creating...
                </span>
              ) : (
                "Launch"
              )}
            </button>
          ) : (
            <button
              className="min-h-[44px] rounded-lg bg-indigo-600 px-6 py-2 font-medium text-sm text-white hover:bg-indigo-500"
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
