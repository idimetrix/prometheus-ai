"use client";

import { Badge, Button, Card, CardContent } from "@prometheus/ui";
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Loader2,
  Rocket,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type DeploymentProvider = "vercel" | "netlify" | "cloudflare" | "docker";

interface PreviewDeployProps {
  projectId: string;
  sessionId?: string;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PROVIDERS: Array<{
  label: string;
  value: DeploymentProvider;
  description: string;
}> = [
  {
    value: "vercel",
    label: "Vercel",
    description: "Deploy to Vercel (requires VERCEL_TOKEN)",
  },
  {
    value: "netlify",
    label: "Netlify",
    description: "Deploy to Netlify (requires NETLIFY_TOKEN)",
  },
  {
    value: "cloudflare",
    label: "Cloudflare",
    description: "Deploy to Cloudflare Pages",
  },
  {
    value: "docker",
    label: "Docker",
    description: "Local Docker container via sandbox-manager",
  },
];

const STATUS_CONFIG: Record<
  string,
  {
    badge: "default" | "success" | "destructive" | "outline";
    icon: typeof Loader2;
    label: string;
    animate?: boolean;
  }
> = {
  queued: {
    badge: "outline",
    icon: Clock,
    label: "Queued",
  },
  building: {
    badge: "default",
    icon: Loader2,
    label: "Building",
    animate: true,
  },
  deploying: {
    badge: "default",
    icon: Loader2,
    label: "Deploying",
    animate: true,
  },
  live: {
    badge: "success",
    icon: CheckCircle,
    label: "Live",
  },
  failed: {
    badge: "destructive",
    icon: XCircle,
    label: "Failed",
  },
  deleted: {
    badge: "outline",
    icon: Trash2,
    label: "Deleted",
  },
};

/* -------------------------------------------------------------------------- */
/*  Deployment Status Badge                                                    */
/* -------------------------------------------------------------------------- */

function DeploymentStatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? {
    badge: "outline" as const,
    icon: Clock,
    label: "Unknown",
  };
  const Icon = config.icon;

  return (
    <Badge variant={config.badge}>
      <Icon
        className={`mr-1 h-3 w-3 ${config.animate ? "animate-spin" : ""}`}
      />
      {config.label}
    </Badge>
  );
}

/* -------------------------------------------------------------------------- */
/*  Build Logs Accordion                                                       */
/* -------------------------------------------------------------------------- */

function BuildLogsSection({ deploymentId }: { deploymentId: string }) {
  const [isOpen, setIsOpen] = useState(false);

  const logsQuery = trpc.deployments.getDeploymentLogs.useQuery(
    { deploymentId },
    { enabled: isOpen }
  );

  return (
    <div className="mt-3 border-zinc-800 border-t pt-3">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="font-medium text-xs text-zinc-400">Build Logs</span>
        {isOpen ? (
          <ChevronUp className="h-3.5 w-3.5 text-zinc-500" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-zinc-500" />
        )}
      </button>

      {isOpen && (
        <div className="mt-2 max-h-48 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3">
          {logsQuery.isLoading && (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading logs...
            </div>
          )}
          {logsQuery.error && (
            <div className="text-red-400 text-xs">
              Failed to load logs: {logsQuery.error.message}
            </div>
          )}
          {logsQuery.data && (
            <>
              <pre className="whitespace-pre-wrap font-mono text-[10px] text-zinc-400 leading-relaxed">
                {logsQuery.data.logs || "No logs available yet."}
              </pre>
              {logsQuery.data.errorMessage && (
                <div className="mt-2 rounded border border-red-800/30 bg-red-950/20 p-2 text-red-400 text-xs">
                  {logsQuery.data.errorMessage}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Deployment Card                                                            */
/* -------------------------------------------------------------------------- */

function DeploymentCard({
  deployment,
  onDelete,
}: {
  deployment: {
    id: string;
    provider: string;
    status: string;
    url: string | null;
    branch: string | null;
    createdAt: Date;
  };
  onDelete: (id: string) => void;
}) {
  const providerInfo = PROVIDERS.find((p) => p.value === deployment.provider);

  return (
    <Card className="border-zinc-800 bg-zinc-900/50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-zinc-200">
              {providerInfo?.label ?? deployment.provider}
            </span>
            {deployment.branch && (
              <span className="rounded-md bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                {deployment.branch}
              </span>
            )}
          </div>
          <DeploymentStatusBadge status={deployment.status} />
        </div>

        {deployment.url && deployment.status === "live" && (
          <a
            className="mt-2 inline-flex items-center gap-1 text-violet-400 text-xs hover:text-violet-300"
            href={deployment.url}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLink className="h-3 w-3" />
            {deployment.url}
          </a>
        )}

        <div className="mt-2 flex items-center justify-between text-[10px] text-zinc-600">
          <span>Created {new Date(deployment.createdAt).toLocaleString()}</span>
          {deployment.status !== "deleted" && (
            <Button
              className="h-6 text-[10px]"
              onClick={() => onDelete(deployment.id)}
              size="sm"
              variant="ghost"
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Delete
            </Button>
          )}
        </div>

        <BuildLogsSection deploymentId={deployment.id} />
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  PreviewDeploy (Main Component)                                             */
/* -------------------------------------------------------------------------- */

export function PreviewDeploy({ projectId, sessionId }: PreviewDeployProps) {
  const [selectedProvider, setSelectedProvider] =
    useState<DeploymentProvider>("vercel");
  const [branch, setBranch] = useState("");

  const utils = trpc.useUtils();

  const deploymentsQuery = trpc.deployments.listDeployments.useQuery({
    projectId,
    limit: 20,
  });

  const createMutation = trpc.deployments.createPreviewDeployment.useMutation({
    onSuccess: () => {
      utils.deployments.listDeployments.invalidate({ projectId });
    },
  });

  const deleteMutation = trpc.deployments.deleteDeployment.useMutation({
    onSuccess: () => {
      utils.deployments.listDeployments.invalidate({ projectId });
    },
  });

  const handleDeploy = () => {
    createMutation.mutate({
      projectId,
      sessionId,
      provider: selectedProvider,
      branch: branch.trim() || undefined,
    });
  };

  const handleDelete = (deploymentId: string) => {
    deleteMutation.mutate({ deploymentId });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Deploy controls */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardContent className="p-4">
          <h3 className="mb-4 font-medium text-sm text-zinc-200">
            Preview Deployment
          </h3>

          <div className="flex flex-col gap-3">
            {/* Provider selector */}
            <div>
              <label
                className="mb-1 block text-[10px] text-zinc-500 uppercase tracking-wider"
                htmlFor="provider-select"
              >
                Provider
              </label>
              <select
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-violet-500"
                id="provider-select"
                onChange={(e) =>
                  setSelectedProvider(e.target.value as DeploymentProvider)
                }
                value={selectedProvider}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label} - {p.description}
                  </option>
                ))}
              </select>
            </div>

            {/* Branch input */}
            <div>
              <label
                className="mb-1 block text-[10px] text-zinc-500 uppercase tracking-wider"
                htmlFor="branch-input"
              >
                Branch (optional)
              </label>
              <input
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500"
                id="branch-input"
                onChange={(e) => setBranch(e.target.value)}
                placeholder="main"
                value={branch}
              />
            </div>

            {/* Deploy button */}
            <Button
              className="w-full"
              disabled={createMutation.isPending}
              onClick={handleDeploy}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Deployment...
                </>
              ) : (
                <>
                  <Rocket className="mr-2 h-4 w-4" />
                  Deploy Preview
                </>
              )}
            </Button>

            {createMutation.error && (
              <div className="rounded-lg border border-red-800/30 bg-red-950/20 p-2 text-red-400 text-xs">
                {createMutation.error.message}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Deployments list */}
      <div>
        <h4 className="mb-3 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
          Deployments
        </h4>

        {deploymentsQuery.isLoading && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading deployments...
          </div>
        )}

        {deploymentsQuery.data?.deployments.length === 0 && (
          <Card className="border-zinc-800 border-dashed bg-zinc-900/30">
            <CardContent className="p-8 text-center">
              <Rocket className="mx-auto h-8 w-8 text-zinc-700" />
              <p className="mt-2 text-sm text-zinc-500">
                No preview deployments yet. Create your first one above.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-col gap-3">
          {deploymentsQuery.data?.deployments.map((deployment) => (
            <DeploymentCard
              deployment={deployment}
              key={deployment.id}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
