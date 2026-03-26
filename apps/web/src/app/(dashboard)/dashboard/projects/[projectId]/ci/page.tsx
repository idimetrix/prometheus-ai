"use client";

import { use, useCallback, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

interface CIRun {
  conclusion: string | null;
  name: string;
  runId: string;
  startedAt: string;
  status: string;
  url: string;
}

const CI_TEMPLATES: Record<string, { label: string; description: string }> = {
  "github-actions": {
    label: "GitHub Actions",
    description: "CI/CD workflows for GitHub repositories",
  },
  "gitlab-ci": {
    label: "GitLab CI",
    description: "Pipeline configuration for GitLab",
  },
  docker: {
    label: "Docker Build",
    description: "Dockerfile and docker-compose based pipelines",
  },
};

function getCIButtonStyle(
  key: string,
  selectedProvider: string | null,
  detectedProvider: string | null
): string {
  if (selectedProvider === key) {
    return "border-indigo-500 bg-indigo-600/10";
  }
  if (key === detectedProvider) {
    return "border-green-500/30 hover:border-green-500";
  }
  return "border-zinc-700 hover:border-zinc-500";
}

function getStatusBadge(status: string, conclusion: string | null): string {
  if (status === "completed") {
    if (conclusion === "success") {
      return "bg-green-500/10 text-green-400";
    }
    if (conclusion === "failure") {
      return "bg-red-500/10 text-red-400";
    }
    return "bg-zinc-800 text-zinc-400";
  }
  if (status === "in_progress") {
    return "bg-yellow-500/10 text-yellow-400";
  }
  return "bg-zinc-800 text-zinc-400";
}

function getStatusLabel(status: string, conclusion: string | null): string {
  if (status === "completed") {
    return conclusion ?? "completed";
  }
  return status;
}

export default function CIPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [generatedConfig, setGeneratedConfig] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const projectQuery = trpc.projects.get.useQuery({ projectId });
  const ciRunsQuery = trpc.integrations.listCIRuns.useQuery(
    { projectId },
    { enabled: Boolean(projectId), refetchInterval: 15_000 }
  );

  const generateConfigMutation = trpc.integrations.generateCIConfig.useMutation(
    {
      onSuccess(data) {
        setGeneratedConfig(data.config);
        toast.success("CI configuration generated!");
      },
      onError(error) {
        toast.error(`Failed to generate config: ${error.message}`);
      },
    }
  );

  const applyConfigMutation = trpc.integrations.applyCIConfig.useMutation({
    onSuccess() {
      toast.success("CI configuration committed to repo!");
      setGeneratedConfig(null);
    },
    onError(error) {
      toast.error(`Failed to apply config: ${error.message}`);
    },
  });

  const handleGenerate = useCallback(
    async (provider: string) => {
      setSelectedProvider(provider);
      setIsGenerating(true);
      try {
        await generateConfigMutation.mutateAsync({
          projectId,
          provider,
        });
      } finally {
        setIsGenerating(false);
      }
    },
    [projectId, generateConfigMutation]
  );

  const handleApply = useCallback(async () => {
    if (!(generatedConfig && selectedProvider)) {
      return;
    }
    setIsApplying(true);
    try {
      await applyConfigMutation.mutateAsync({
        projectId,
        provider: selectedProvider,
        config: generatedConfig,
      });
    } finally {
      setIsApplying(false);
    }
  }, [projectId, generatedConfig, selectedProvider, applyConfigMutation]);

  const runs: CIRun[] = (ciRunsQuery.data?.runs ?? []) as CIRun[];
  const detectedProvider =
    ((projectQuery.data?.settings as Record<string, unknown> | undefined)
      ?.ciProvider as string | null) ?? null;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="font-bold text-2xl text-white">CI/CD Pipeline</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Configure and monitor continuous integration for your project
        </p>
      </div>

      {/* Detected provider */}
      {detectedProvider && (
        <div className="mb-6 rounded-lg border border-green-500/20 bg-green-500/5 p-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-400" />
            <span className="font-medium text-green-400 text-sm">
              Detected:{" "}
              {CI_TEMPLATES[detectedProvider]?.label ?? detectedProvider}
            </span>
          </div>
        </div>
      )}

      {/* Generate CI config */}
      <div className="mb-8">
        <h2 className="mb-3 font-semibold text-lg text-white">
          Generate CI Configuration
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(CI_TEMPLATES).map(([key, tmpl]) => (
            <button
              className={`rounded-lg border p-4 text-left transition-colors ${getCIButtonStyle(key, selectedProvider, detectedProvider)}`}
              disabled={isGenerating}
              key={key}
              onClick={() => handleGenerate(key)}
              type="button"
            >
              <div className="font-medium text-white">{tmpl.label}</div>
              <div className="mt-1 text-xs text-zinc-400">
                {tmpl.description}
              </div>
              {key === detectedProvider && (
                <span className="mt-2 inline-block rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400">
                  Detected
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Generated config preview */}
      {generatedConfig && (
        <div className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-lg text-white">
              Generated Configuration
            </h2>
            <div className="flex gap-2">
              <button
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:text-white"
                onClick={() => {
                  navigator.clipboard.writeText(generatedConfig).catch(() => {
                    // Clipboard access may fail in some browsers
                  });
                  toast.success("Copied to clipboard");
                }}
                type="button"
              >
                Copy
              </button>
              <button
                className="rounded-lg bg-indigo-600 px-4 py-1.5 font-medium text-sm text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isApplying}
                onClick={handleApply}
                type="button"
              >
                {isApplying ? "Applying..." : "Apply to Repo"}
              </button>
            </div>
          </div>
          <div className="overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <pre className="font-mono text-sm text-zinc-300">
              {generatedConfig}
            </pre>
          </div>
        </div>
      )}

      {/* Recent CI runs */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-lg text-white">Recent CI Runs</h2>
          <button
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:text-white"
            onClick={() => ciRunsQuery.refetch()}
            type="button"
          >
            Refresh
          </button>
        </div>

        {runs.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 border-dashed bg-zinc-900/30 p-12 text-center">
            <p className="text-sm text-zinc-500">No CI runs found</p>
            <p className="mt-1 text-xs text-zinc-600">
              Configure CI above or push changes to trigger a run
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {runs.map((run) => (
              <div
                className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 transition-colors hover:border-zinc-700"
                key={run.runId}
              >
                <div
                  className={`rounded-full px-2 py-0.5 font-medium text-xs ${getStatusBadge(
                    run.status,
                    run.conclusion
                  )}`}
                >
                  {getStatusLabel(run.status, run.conclusion)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-sm text-zinc-200">
                    {run.name}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {new Date(run.startedAt).toLocaleString()}
                  </div>
                </div>
                {run.url && (
                  <a
                    className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white"
                    href={run.url}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    View
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
