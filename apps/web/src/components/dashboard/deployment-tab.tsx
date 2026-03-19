"use client";

import { Badge, Button, Card, CardContent } from "@prometheus/ui";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  ExternalLink,
  GitCommit,
  Loader2,
  Rocket,
  RotateCcw,
  Server,
  XCircle,
} from "lucide-react";
import { useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type PipelineStage = "build" | "test" | "deploy";
export type StageStatus =
  | "pending"
  | "running"
  | "success"
  | "failed"
  | "skipped";

export interface PipelineStageInfo {
  duration?: number;
  name: PipelineStage;
  status: StageStatus;
}

export interface DeploymentRecord {
  commitMessage: string;
  commitSha: string;
  duration: number;
  environment: "staging" | "production";
  id: string;
  pipeline: PipelineStageInfo[];
  status: "success" | "failed" | "running" | "pending" | "rolled_back";
  timestamp: string;
  triggeredBy: string;
}

export interface EnvironmentHealth {
  environment: "staging" | "production";
  healthy: boolean;
  lastDeployedAt: string;
  responseTime: number;
  uptime: number;
  version: string;
}

interface DeploymentTabProps {
  deployments: DeploymentRecord[];
  environments: EnvironmentHealth[];
  onRollback?: (deploymentId: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const STAGE_ICONS: Record<PipelineStage, typeof Rocket> = {
  build: Server,
  test: CheckCircle,
  deploy: Rocket,
};

const STAGE_STATUS_STYLES: Record<
  StageStatus,
  { bg: string; border: string; icon: string; text: string }
> = {
  pending: {
    bg: "bg-zinc-800",
    border: "border-zinc-700",
    text: "text-zinc-500",
    icon: "text-zinc-600",
  },
  running: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    icon: "text-blue-400",
  },
  success: {
    bg: "bg-green-500/10",
    border: "border-green-500/30",
    text: "text-green-400",
    icon: "text-green-500",
  },
  failed: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-400",
    icon: "text-red-500",
  },
  skipped: {
    bg: "bg-zinc-800/50",
    border: "border-zinc-800",
    text: "text-zinc-600",
    icon: "text-zinc-600",
  },
};

const DEPLOYMENT_STATUS_BADGE: Record<
  DeploymentRecord["status"],
  "success" | "default" | "destructive" | "outline"
> = {
  success: "success",
  failed: "destructive",
  running: "default",
  pending: "outline",
  rolled_back: "outline",
};

/* -------------------------------------------------------------------------- */
/*  Pipeline Visualization                                                     */
/* -------------------------------------------------------------------------- */

function PipelineVisualization({ stages }: { stages: PipelineStageInfo[] }) {
  return (
    <div className="flex items-center gap-1">
      {stages.map((stage, index) => {
        const StageIcon = STAGE_ICONS[stage.name];
        const styles = STAGE_STATUS_STYLES[stage.status];

        return (
          <div className="flex items-center" key={stage.name}>
            <div
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 ${styles.bg} ${styles.border}`}
            >
              {stage.status === "running" ? (
                <Loader2 className={`h-3 w-3 animate-spin ${styles.icon}`} />
              ) : (
                <StageIcon className={`h-3 w-3 ${styles.icon}`} />
              )}
              <span
                className={`font-medium text-[10px] capitalize ${styles.text}`}
              >
                {stage.name}
              </span>
              {stage.duration !== undefined && stage.status !== "pending" && (
                <span className="font-mono text-[9px] text-zinc-600">
                  {formatDuration(stage.duration)}
                </span>
              )}
            </div>
            {index < stages.length - 1 && (
              <ArrowRight className="mx-0.5 h-3 w-3 text-zinc-700" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Environment Health Card                                                    */
/* -------------------------------------------------------------------------- */

function EnvironmentHealthCard({ env }: { env: EnvironmentHealth }) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                env.healthy
                  ? "bg-green-500 shadow-[0_0_6px] shadow-green-500/50"
                  : "bg-red-500 shadow-[0_0_6px] shadow-red-500/50"
              }`}
            />
            <span className="font-medium text-sm text-zinc-200 capitalize">
              {env.environment}
            </span>
          </div>
          <Badge variant={env.healthy ? "success" : "destructive"}>
            {env.healthy ? "Healthy" : "Unhealthy"}
          </Badge>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-zinc-600">Version</div>
            <div className="font-mono text-xs text-zinc-300">{env.version}</div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-600">Uptime</div>
            <div className="font-mono text-xs text-zinc-300">
              {env.uptime.toFixed(2)}%
            </div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-600">Response Time</div>
            <div className="font-mono text-xs text-zinc-300">
              {env.responseTime}ms
            </div>
          </div>
          <div>
            <div className="text-[10px] text-zinc-600">Last Deploy</div>
            <div className="text-xs text-zinc-300">
              {new Date(env.lastDeployedAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

/* -------------------------------------------------------------------------- */
/*  DeploymentTab                                                              */
/* -------------------------------------------------------------------------- */

export function DeploymentTab({
  deployments,
  environments,
  onRollback,
}: DeploymentTabProps) {
  const [selectedEnv, setSelectedEnv] = useState<
    "all" | "staging" | "production"
  >("all");

  const filteredDeployments =
    selectedEnv === "all"
      ? deployments
      : deployments.filter((d) => d.environment === selectedEnv);

  const latestDeployment = deployments.find(
    (d) => d.status === "running" || d.status === "success"
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Environment health */}
      <div>
        <h4 className="mb-3 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
          Environment Status
        </h4>
        <div className="grid gap-4 md:grid-cols-2">
          {environments.map((env) => (
            <EnvironmentHealthCard env={env} key={env.environment} />
          ))}
        </div>
      </div>

      {/* Current pipeline */}
      {latestDeployment && (
        <Card className="border-zinc-800 bg-zinc-900/50">
          <CardContent className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-medium text-sm text-zinc-200">
                Current Pipeline
              </h4>
              <Badge variant={DEPLOYMENT_STATUS_BADGE[latestDeployment.status]}>
                {latestDeployment.status}
              </Badge>
            </div>
            <PipelineVisualization stages={latestDeployment.pipeline} />
            <div className="mt-3 flex items-center gap-3 text-[10px] text-zinc-500">
              <div className="flex items-center gap-1">
                <GitCommit className="h-3 w-3" />
                <span className="font-mono">
                  {latestDeployment.commitSha.slice(0, 7)}
                </span>
              </div>
              <span>{latestDeployment.commitMessage}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deployment history */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
            Deployment History
          </h4>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-0.5">
            {(["all", "staging", "production"] as const).map((env) => (
              <button
                className={`rounded-md px-3 py-1 text-[10px] transition-colors ${
                  selectedEnv === env
                    ? "bg-zinc-800 font-medium text-zinc-200"
                    : "text-zinc-500 hover:text-zinc-400"
                }`}
                key={env}
                onClick={() => setSelectedEnv(env)}
                type="button"
              >
                {env === "all" ? "All" : env}
              </button>
            ))}
          </div>
        </div>

        {filteredDeployments.length === 0 ? (
          <Card className="border-zinc-800 border-dashed bg-zinc-900/30">
            <CardContent className="p-8 text-center">
              <Rocket className="mx-auto h-8 w-8 text-zinc-700" />
              <p className="mt-2 text-sm text-zinc-500">No deployments found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full">
              <thead>
                <tr className="border-zinc-800 border-b bg-zinc-900/50">
                  <th className="px-4 py-2.5 text-left font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                    Commit
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                    Environment
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                    Pipeline
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                    Duration
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                    When
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {filteredDeployments.map((deployment) => (
                  <tr
                    className="transition-colors hover:bg-zinc-900/30"
                    key={deployment.id}
                  >
                    {/* Status */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {deployment.status === "success" && (
                          <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                        )}
                        {deployment.status === "failed" && (
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                        )}
                        {deployment.status === "running" && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                        )}
                        {deployment.status === "pending" && (
                          <Clock className="h-3.5 w-3.5 text-zinc-500" />
                        )}
                        {deployment.status === "rolled_back" && (
                          <RotateCcw className="h-3.5 w-3.5 text-amber-500" />
                        )}
                        <Badge
                          variant={DEPLOYMENT_STATUS_BADGE[deployment.status]}
                        >
                          {deployment.status.replace("_", " ")}
                        </Badge>
                      </div>
                    </td>

                    {/* Commit */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <GitCommit className="h-3 w-3 text-zinc-600" />
                        <span className="font-mono text-xs text-zinc-300">
                          {deployment.commitSha.slice(0, 7)}
                        </span>
                      </div>
                      <div className="mt-0.5 max-w-[200px] truncate text-[10px] text-zinc-600">
                        {deployment.commitMessage}
                      </div>
                    </td>

                    {/* Environment */}
                    <td className="px-4 py-3">
                      <Badge
                        className="text-[9px] capitalize"
                        variant={
                          deployment.environment === "production"
                            ? "default"
                            : "outline"
                        }
                      >
                        {deployment.environment}
                      </Badge>
                    </td>

                    {/* Pipeline mini view */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-0.5">
                        {deployment.pipeline.map((stage) => {
                          const styles = STAGE_STATUS_STYLES[stage.status];
                          return (
                            <div
                              className={`h-1.5 w-6 rounded-full ${styles.bg} border ${styles.border}`}
                              key={stage.name}
                              title={`${stage.name}: ${stage.status}`}
                            />
                          );
                        })}
                      </div>
                    </td>

                    {/* Duration */}
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-zinc-400">
                        {formatDuration(deployment.duration)}
                      </span>
                    </td>

                    {/* Timestamp */}
                    <td className="px-4 py-3">
                      <span className="text-xs text-zinc-500">
                        {new Date(deployment.timestamp).toLocaleDateString()}
                      </span>
                      <div className="text-[10px] text-zinc-600">
                        {new Date(deployment.timestamp).toLocaleTimeString()}
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {deployment.status === "success" && onRollback && (
                          <Button
                            onClick={() => onRollback(deployment.id)}
                            size="sm"
                            variant="outline"
                          >
                            <RotateCcw className="mr-1 h-3 w-3" />
                            Rollback
                          </Button>
                        )}
                        <Button size="sm" variant="ghost">
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
