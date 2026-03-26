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
  "Analyze this codebase and tell me what it does",
  "Add a user profile page with avatar upload",
  "Create a REST API for todo items with CRUD",
  "Set up authentication with email/password and OAuth",
  "Build a dashboard with analytics charts",
];

const ONBOARDING_COMPLETE_KEY = "prometheus:onboarding-complete";

type RepoMode = "oauth" | "url";

const PROVIDER_ICONS: Record<string, string> = {
  GitHub: "GH",
  GitLab: "GL",
  Bitbucket: "BB",
};

function getProgressBarColor(idx: number, currentIdx: number): string {
  if (idx < currentIdx) {
    return "bg-green-500";
  }
  if (idx === currentIdx) {
    return "bg-indigo-500";
  }
  return "bg-zinc-700";
}

function getProgressLabelColor(idx: number, currentIdx: number): string {
  if (idx < currentIdx) {
    return "text-green-400";
  }
  if (idx === currentIdx) {
    return "text-indigo-400";
  }
  return "text-zinc-600";
}

function detectStackFromUrl(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.includes("next") || lower.includes("react")) {
    return "nextjs";
  }
  if (lower.includes("django") || lower.includes("python")) {
    return "django-react";
  }
  if (lower.includes("rails") || lower.includes("ruby")) {
    return "rails";
  }
  if (lower.includes("go") || lower.includes("golang")) {
    return "go-htmx";
  }
  return null;
}

function getPresetBorderClass(
  selectedPreset: string,
  presetId: string,
  detectedStack: string | null
): string {
  if (selectedPreset === presetId) {
    return "border-indigo-500 bg-indigo-600/10";
  }
  if (presetId === detectedStack) {
    return "border-green-500/50 hover:border-green-500";
  }
  return "border-zinc-700 hover:border-zinc-500";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Multi-step onboarding wizard with conditional rendering per step
export default function OnboardingPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("org");
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [taskInput, setTaskInput] = useState("");
  const [repoConnected, setRepoConnected] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [repoMode, setRepoMode] = useState<RepoMode>("oauth");
  const [manualRepoUrl, setManualRepoUrl] = useState("");
  const [detectedStack, setDetectedStack] = useState<string | null>(null);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});

  const searchParams = useSearchParams();
  const currentIdx = STEPS.findIndex((s) => s.key === currentStep);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);

  // Check if onboarding is already complete
  useEffect(() => {
    if (typeof window !== "undefined") {
      const complete = localStorage.getItem(ONBOARDING_COMPLETE_KEY);
      if (complete === "true") {
        router.push("/dashboard");
      }
    }
  }, [router]);

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
      setStepErrors((prev) => ({ ...prev, org: error.message }));
      setIsCreatingOrg(false);
    },
  });

  const createProject = trpc.projects.create.useMutation({
    onError(error) {
      toast.error(`Failed to create project: ${error.message}`);
      setStepErrors((prev) => ({ ...prev, "first-task": error.message }));
    },
  });

  const createSession = trpc.sessions.create.useMutation({
    onError(error) {
      toast.error(`Failed to create session: ${error.message}`);
      setStepErrors((prev) => ({ ...prev, "first-task": error.message }));
    },
  });

  const clearError = useCallback(
    (step: string) => {
      if (stepErrors[step]) {
        setStepErrors((prev) => {
          const next = { ...prev };
          delete next[step];
          return next;
        });
      }
    },
    [stepErrors]
  );

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Step validation requires checking multiple conditions per step
  const handleNext = useCallback(async () => {
    clearError(currentStep);

    // Validate current step before proceeding
    if (currentStep === "org" && !orgName.trim()) {
      toast.error("Please enter an organization name");
      setStepErrors((prev) => ({
        ...prev,
        org: "Organization name is required",
      }));
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

    // Validate repo step - allow manual URL
    if (currentStep === "repo" && repoMode === "url" && manualRepoUrl.trim()) {
      setRepoConnected("Manual");
      const stack = detectStackFromUrl(manualRepoUrl);
      if (stack) {
        setDetectedStack(stack);
        setSelectedPreset(stack);
      }
    }

    const nextIdx = currentIdx + 1;
    if (nextIdx < STEPS.length) {
      const nextStep = STEPS[nextIdx];
      if (nextStep) {
        setCurrentStep(nextStep.key);
      }
    }
  }, [
    currentIdx,
    currentStep,
    orgName,
    orgId,
    createOrg,
    repoMode,
    manualRepoUrl,
    clearError,
  ]);

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
    clearError("first-task");

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
        repoUrl: manualRepoUrl.trim() || undefined,
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
    manualRepoUrl,
    createProject,
    createSession,
    router,
    clearError,
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
          Skip to Dashboard
        </button>
      </div>

      {/* Progress bar */}
      <div className="mb-8 flex gap-2">
        {STEPS.map((step, idx) => (
          <div className="flex-1" key={step.key}>
            <div
              className={`h-1.5 rounded-full transition-colors ${getProgressBarColor(idx, currentIdx)}`}
            />
            <div
              className={`mt-2 text-xs ${getProgressLabelColor(idx, currentIdx)}`}
            >
              {idx < currentIdx ? `\u2713 ${step.title}` : step.title}
            </div>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
        {currentStep === "org" && (
          <div>
            <h2 className="mb-1 font-semibold text-white text-xl">
              Create Your Organization
            </h2>
            <p className="mb-4 text-sm text-zinc-500">
              This is your team workspace where projects and members are
              managed.
            </p>
            <label
              className="mb-1 block text-sm text-zinc-400"
              htmlFor="org-name"
            >
              Organization Name
            </label>
            <input
              className="mb-3 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              id="org-name"
              onChange={(e) => {
                setOrgName(e.target.value);
                setOrgSlug(
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "")
                );
                clearError("org");
              }}
              placeholder="Acme Corp"
              value={orgName}
            />
            {orgSlug && (
              <p className="text-xs text-zinc-500">
                Slug: <span className="font-mono text-zinc-400">{orgSlug}</span>
              </p>
            )}
            {stepErrors.org && (
              <p className="mt-2 text-red-400 text-sm">{stepErrors.org}</p>
            )}
          </div>
        )}

        {currentStep === "repo" && (
          <div>
            <h2 className="mb-1 font-semibold text-white text-xl">
              Connect Your Repository
            </h2>
            <p className="mb-4 text-sm text-zinc-500">
              Link an existing repo or paste a URL. You can skip this step.
            </p>

            {/* Mode toggle */}
            <div className="mb-4 flex gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
              <button
                className={`flex-1 rounded-md px-3 py-2 text-sm transition-colors ${
                  repoMode === "oauth"
                    ? "bg-zinc-800 font-medium text-white"
                    : "text-zinc-400 hover:text-zinc-300"
                }`}
                onClick={() => setRepoMode("oauth")}
                type="button"
              >
                Connect via OAuth
              </button>
              <button
                className={`flex-1 rounded-md px-3 py-2 text-sm transition-colors ${
                  repoMode === "url"
                    ? "bg-zinc-800 font-medium text-white"
                    : "text-zinc-400 hover:text-zinc-300"
                }`}
                onClick={() => setRepoMode("url")}
                type="button"
              >
                Paste URL
              </button>
            </div>

            {repoMode === "oauth" && (
              <div className="space-y-3">
                {["GitHub", "GitLab", "Bitbucket"].map((provider) => (
                  <button
                    className={`flex w-full items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                      repoConnected === provider
                        ? "border-green-500 bg-green-600/10"
                        : "border-zinc-700 hover:border-zinc-500"
                    }`}
                    key={provider}
                    onClick={() => handleConnectRepo(provider)}
                    type="button"
                  >
                    <span className="text-2xl">
                      {PROVIDER_ICONS[provider] ?? ""}
                    </span>
                    <div className="flex-1">
                      <div className="font-medium text-white">{provider}</div>
                      <div className="text-sm text-zinc-400">
                        Connect via OAuth
                      </div>
                    </div>
                    {repoConnected === provider && (
                      <span className="text-green-400 text-sm">Connected</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {repoMode === "url" && (
              <div>
                <label
                  className="mb-1 block text-sm text-zinc-400"
                  htmlFor="repo-url"
                >
                  Repository URL
                </label>
                <input
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
                  id="repo-url"
                  onChange={(e) => setManualRepoUrl(e.target.value)}
                  placeholder="https://github.com/org/repo.git"
                  value={manualRepoUrl}
                />
                {manualRepoUrl.trim() && (
                  <p className="mt-2 text-green-400 text-xs">
                    Repository URL set. We&apos;ll clone and analyze it when
                    creating your project.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {currentStep === "preset" && (
          <div>
            <h2 className="mb-1 font-semibold text-white text-xl">
              Choose Your Tech Stack
            </h2>
            <p className="mb-4 text-sm text-zinc-500">
              {detectedStack
                ? `We detected ${detectedStack} from your repo. Confirm or choose a different stack.`
                : "Select the tech stack for your project, or skip to let AI detect it."}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {PRESETS.map((preset) => (
                <button
                  className={`rounded-lg border p-4 text-left transition-colors ${getPresetBorderClass(selectedPreset, preset.id, detectedStack)}`}
                  key={preset.id}
                  onClick={() => setSelectedPreset(preset.id)}
                  type="button"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-bold text-lg text-white">
                      {preset.icon}
                    </span>
                    {preset.id === detectedStack && (
                      <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400">
                        Detected
                      </span>
                    )}
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
            <h2 className="mb-1 font-semibold text-white text-xl">
              Run Your First Task
            </h2>
            <p className="mb-4 text-sm text-zinc-500">
              Describe what you want AI to do. Start simple — you can always
              submit more tasks later.
            </p>
            <label className="sr-only" htmlFor="first-task-input">
              Task description
            </label>
            <textarea
              aria-label="Task description"
              className="mb-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
              id="first-task-input"
              onChange={(e) => {
                setTaskInput(e.target.value);
                clearError("first-task");
              }}
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
                    className={`min-h-[44px] rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      taskInput === task
                        ? "border-indigo-500 bg-indigo-500/10 text-indigo-400"
                        : "border-zinc-700 text-zinc-400 hover:border-indigo-500 hover:text-indigo-400"
                    }`}
                    key={task}
                    onClick={() => setTaskInput(task)}
                    type="button"
                  >
                    {task}
                  </button>
                ))}
              </div>
            </div>
            {stepErrors["first-task"] && (
              <p className="mb-2 text-red-400 text-sm">
                {stepErrors["first-task"]}
              </p>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              className="min-h-[44px] rounded-lg px-4 py-2 text-sm text-zinc-400 hover:text-white disabled:invisible"
              disabled={currentIdx === 0}
              onClick={handleBack}
              type="button"
            >
              Back
            </button>
            {currentStep !== "org" && currentStep !== "first-task" && (
              <button
                className="min-h-[44px] rounded-lg px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300"
                onClick={handleNext}
                type="button"
              >
                Skip Step
              </button>
            )}
          </div>

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
              className={`min-h-[44px] rounded-lg px-6 py-2 font-medium text-sm text-white ${
                isCreatingOrg
                  ? "cursor-not-allowed bg-indigo-600/50"
                  : "bg-indigo-600 hover:bg-indigo-500"
              }`}
              disabled={isCreatingOrg}
              onClick={handleNext}
              type="button"
            >
              {isCreatingOrg ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Creating...
                </span>
              ) : (
                "Continue"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
