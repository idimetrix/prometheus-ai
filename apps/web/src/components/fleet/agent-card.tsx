"use client";

import { Button } from "@prometheus/ui";
import {
  Bot,
  Code2,
  Database,
  Globe,
  Layers,
  Pause,
  Play,
  Search,
  Shield,
  Square,
  TestTube,
  Workflow,
  Wrench,
} from "lucide-react";
import type { ComponentType } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface Agent {
  id: string;
  role: string;
  startedAt?: string;
  status: string;
  tokensIn?: number;
  tokensOut?: number;
}

interface AgentCardProps {
  agent: Agent;
  creditsConsumed: number;
  currentTaskTitle?: string;
  onPause: (agentId: string) => void;
  onResume: (agentId: string) => void;
  onStop: (agentId: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const STATUS_INDICATORS: Record<string, { color: string; label: string }> = {
  idle: { color: "bg-zinc-500", label: "Idle" },
  working: { color: "bg-green-500 animate-pulse", label: "Working" },
  waiting: { color: "bg-yellow-500", label: "Waiting" },
  paused: { color: "bg-yellow-500", label: "Paused" },
  terminated: { color: "bg-red-500", label: "Terminated" },
  error: { color: "bg-red-500", label: "Error" },
  completed: { color: "bg-blue-500", label: "Completed" },
};

const ROLE_COLORS: Record<string, string> = {
  orchestrator: "bg-violet-500/20 text-violet-400 border-violet-500/30",
  discovery: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  architect: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  frontend: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "frontend-coder": "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  backend: "bg-green-500/20 text-green-400 border-green-500/30",
  "backend-coder": "bg-green-500/20 text-green-400 border-green-500/30",
  database: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  devops: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  testing: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  "test-engineer": "bg-pink-500/20 text-pink-400 border-pink-500/30",
  security: "bg-red-500/20 text-red-400 border-red-500/30",
  "security-auditor": "bg-red-500/20 text-red-400 border-red-500/30",
  documentation: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
  "ci-loop": "bg-amber-500/20 text-amber-400 border-amber-500/30",
  deployment: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

const ROLE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  orchestrator: Workflow,
  discovery: Search,
  architect: Layers,
  frontend: Globe,
  "frontend-coder": Globe,
  backend: Code2,
  "backend-coder": Code2,
  database: Database,
  devops: Wrench,
  testing: TestTube,
  "test-engineer": TestTube,
  security: Shield,
  "security-auditor": Shield,
  documentation: Bot,
  "ci-loop": Workflow,
  deployment: Layers,
};

/* -------------------------------------------------------------------------- */
/*  Confidence Estimation                                                     */
/* -------------------------------------------------------------------------- */

function estimateConfidence(agent: Agent): number {
  // Confidence is simulated based on status and token usage
  if (agent.status === "completed") {
    return 100;
  }
  if (agent.status === "error" || agent.status === "terminated") {
    return 0;
  }
  if (agent.status === "idle") {
    return 50;
  }

  const totalTokens = (agent.tokensIn ?? 0) + (agent.tokensOut ?? 0);
  // Higher token usage generally means more progress
  const tokenConfidence = Math.min(85, Math.floor(totalTokens / 100));
  return Math.max(15, tokenConfidence);
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 80) {
    return "bg-green-500";
  }
  if (confidence >= 50) {
    return "bg-yellow-500";
  }
  if (confidence >= 25) {
    return "bg-orange-500";
  }
  return "bg-red-500";
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function AgentCard({
  agent,
  creditsConsumed,
  currentTaskTitle,
  onPause,
  onResume,
  onStop,
}: AgentCardProps) {
  const statusInfo = STATUS_INDICATORS[agent.status] ?? STATUS_INDICATORS.idle;
  const roleColor =
    ROLE_COLORS[agent.role] ??
    "bg-zinc-500/20 text-zinc-400 border-zinc-500/30";
  const RoleIcon = ROLE_ICONS[agent.role] ?? Bot;
  const confidence = estimateConfidence(agent);
  const confidenceColor = getConfidenceColor(confidence);
  const totalTokens = (agent.tokensIn ?? 0) + (agent.tokensOut ?? 0);

  return (
    <div className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700">
      {/* Header: Role + Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-lg border ${roleColor}`}
          >
            <RoleIcon className="h-4 w-4" />
          </div>
          <div>
            <span className="font-medium text-sm text-zinc-200">
              {agent.role}
            </span>
            <div className="font-mono text-[10px] text-zinc-600">
              {agent.id.slice(0, 12)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${statusInfo?.color ?? "bg-zinc-500"}`}
          />
          <span className="text-[10px] text-zinc-500">
            {statusInfo?.label ?? agent.status}
          </span>
        </div>
      </div>

      {/* Confidence Meter */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-500">Confidence</span>
          <span className="font-mono text-[10px] text-zinc-400">
            {confidence}%
          </span>
        </div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-500 ${confidenceColor}`}
            style={{ width: `${confidence}%` }}
          />
        </div>
      </div>

      {/* Metrics */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] text-zinc-600">Tokens In</div>
          <div className="font-mono text-xs text-zinc-300">
            {(agent.tokensIn ?? 0).toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-600">Tokens Out</div>
          <div className="font-mono text-xs text-zinc-300">
            {(agent.tokensOut ?? 0).toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-600">Credits</div>
          <div className="font-mono text-xs text-zinc-300">
            {creditsConsumed}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-zinc-600">Started</div>
          <div className="text-xs text-zinc-300">
            {agent.startedAt
              ? new Date(agent.startedAt).toLocaleTimeString()
              : "--"}
          </div>
        </div>
      </div>

      {/* Current Task */}
      {currentTaskTitle && (
        <div className="mt-3 rounded-lg bg-zinc-800/50 px-3 py-2">
          <div className="text-[10px] text-zinc-600">Current Task</div>
          <div className="mt-0.5 truncate text-xs text-zinc-300">
            {currentTaskTitle}
          </div>
        </div>
      )}

      {/* Token usage bar */}
      <div className="mt-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-zinc-600">Token Usage</span>
          <span className="font-mono text-[10px] text-zinc-500">
            {totalTokens > 1000
              ? `${(totalTokens / 1000).toFixed(1)}k`
              : totalTokens}
          </span>
        </div>
        <div className="mt-1 flex gap-0.5">
          <div
            className="h-1 rounded-l-full bg-blue-500/60"
            style={{
              width:
                totalTokens > 0
                  ? `${((agent.tokensIn ?? 0) / totalTokens) * 100}%`
                  : "50%",
            }}
            title="Tokens in"
          />
          <div
            className="h-1 rounded-r-full bg-violet-500/60"
            style={{
              width:
                totalTokens > 0
                  ? `${((agent.tokensOut ?? 0) / totalTokens) * 100}%`
                  : "50%",
            }}
            title="Tokens out"
          />
        </div>
        <div className="mt-0.5 flex justify-between text-[9px] text-zinc-600">
          <span>In</span>
          <span>Out</span>
        </div>
      </div>

      {/* Actions */}
      {agent.status !== "terminated" &&
        agent.status !== "error" &&
        agent.status !== "completed" && (
          <div className="mt-3 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            {agent.status === "working" && (
              <Button
                className="flex-1"
                onClick={() => onPause(agent.id)}
                size="sm"
                variant="outline"
              >
                <Pause className="mr-1 h-3 w-3" />
                Pause
              </Button>
            )}
            {(agent.status === "idle" ||
              agent.status === ("waiting" as string) ||
              agent.status === ("paused" as string)) && (
              <Button
                className="flex-1"
                onClick={() => onResume(agent.id)}
                size="sm"
                variant="outline"
              >
                <Play className="mr-1 h-3 w-3" />
                Resume
              </Button>
            )}
            <Button
              className="flex-1"
              onClick={() => onStop(agent.id)}
              size="sm"
              variant="outline"
            >
              <Square className="mr-1 h-3 w-3" />
              Stop
            </Button>
          </div>
        )}
    </div>
  );
}
