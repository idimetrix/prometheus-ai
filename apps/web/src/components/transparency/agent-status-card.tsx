"use client";

import type { ActiveAgent } from "@/stores/session.store";

interface AgentStatusCardProps {
  agent: ActiveAgent;
  model?: string;
}

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  working: { color: "bg-green-500", label: "Working" },
  idle: { color: "bg-zinc-500", label: "Idle" },
  waiting: { color: "bg-yellow-500", label: "Waiting" },
  error: { color: "bg-red-500", label: "Error" },
  terminated: { color: "bg-zinc-700", label: "Terminated" },
};

const ROLE_COLORS: Record<string, string> = {
  architect: "text-violet-400",
  "backend-coder": "text-blue-400",
  "frontend-coder": "text-cyan-400",
  "test-engineer": "text-green-400",
  "security-auditor": "text-red-400",
  discovery: "text-amber-400",
  "ci-loop": "text-orange-400",
};

export function AgentStatusCard({ agent, model }: AgentStatusCardProps) {
  const statusInfo = STATUS_CONFIG[agent.status] ?? {
    color: "bg-zinc-500",
    label: agent.status,
  };
  const roleColor = ROLE_COLORS[agent.role] ?? "text-zinc-400";
  const totalTokens = agent.tokensIn + agent.tokensOut;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${statusInfo.color}`}
        />
        <span className={`font-medium text-sm ${roleColor}`}>{agent.role}</span>
        <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
          {statusInfo.label}
        </span>
      </div>

      {/* Details */}
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {model && (
          <div className="col-span-2 flex justify-between">
            <span className="text-zinc-600">Model</span>
            <span className="font-mono text-zinc-400">{model}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-zinc-600">Steps</span>
          <span className="font-mono text-zinc-400">
            {agent.stepsCompleted}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-600">Tokens</span>
          <span className="font-mono text-zinc-400">
            {totalTokens > 1000
              ? `${(totalTokens / 1000).toFixed(1)}k`
              : totalTokens}
          </span>
        </div>
        {agent.currentTask && (
          <div className="col-span-2 mt-1 truncate text-zinc-500">
            {agent.currentTask}
          </div>
        )}
      </div>
    </div>
  );
}
