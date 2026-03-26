"use client";

import { useEffect, useMemo, useState } from "react";
import { useSessionStore } from "@/stores/session.store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return String(count);
}

function getCostSeverity(
  consumed: number,
  budget: number
): "normal" | "warning" | "critical" {
  if (budget <= 0) {
    return "normal";
  }
  const ratio = consumed / budget;
  if (ratio >= 0.9) {
    return "critical";
  }
  if (ratio >= 0.7) {
    return "warning";
  }
  return "normal";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentCostBreakdown {
  credits: number;
  role: string;
  tokensIn: number;
  tokensOut: number;
}

interface TaskCostTrackerProps {
  /** Total credit budget for this task (0 = unlimited) */
  creditBudget?: number;
  /** Task start time as ISO string */
  startedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskCostTracker({
  startedAt,
  creditBudget = 0,
}: TaskCostTrackerProps) {
  const { events, agents, taskProgress } = useSessionStore();

  // ---- Live elapsed time counter ----
  const [elapsedMs, setElapsedMs] = useState(0);

  const startTime = useMemo(() => {
    if (startedAt) {
      return new Date(startedAt).getTime();
    }
    return taskProgress?.startedAt
      ? new Date(taskProgress.startedAt).getTime()
      : null;
  }, [startedAt, taskProgress?.startedAt]);

  useEffect(() => {
    if (!startTime) {
      return;
    }

    setElapsedMs(Date.now() - startTime);

    const handle = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 1000);

    return () => clearInterval(handle);
  }, [startTime]);

  // ---- Aggregate token usage from events ----
  const tokenUsage = useMemo(() => {
    let tokensIn = 0;
    let tokensOut = 0;

    for (const event of events) {
      if (event.type === "credit_update" || event.type === "agent_output") {
        tokensIn += (event.data.tokensIn as number) ?? 0;
        tokensOut += (event.data.tokensOut as number) ?? 0;
      }
    }

    return { tokensIn, tokensOut, total: tokensIn + tokensOut };
  }, [events]);

  // ---- Credits consumed ----
  const creditsConsumed = useMemo(() => {
    if (taskProgress?.creditsConsumed != null) {
      return taskProgress.creditsConsumed;
    }

    const lastCreditEvent = [...events]
      .reverse()
      .find((e) => e.type === "credit_update");

    return (lastCreditEvent?.data.sessionCost as number) ?? 0;
  }, [events, taskProgress?.creditsConsumed]);

  // ---- Per-agent cost breakdown ----
  const agentBreakdown: AgentCostBreakdown[] = useMemo(() => {
    if (agents.length === 0) {
      return [];
    }

    return agents.map((agent) => ({
      role: agent.role,
      tokensIn: agent.tokensIn,
      tokensOut: agent.tokensOut,
      credits: Math.ceil((agent.tokensIn + agent.tokensOut) / 1000),
    }));
  }, [agents]);

  // ---- Estimated remaining ----
  const estimatedRemaining = useMemo(() => {
    if (creditBudget <= 0 || creditsConsumed <= 0 || !elapsedMs) {
      return null;
    }
    const rate = creditsConsumed / elapsedMs;
    const remaining = creditBudget - creditsConsumed;
    if (remaining <= 0) {
      return 0;
    }
    return Math.ceil(remaining / rate / 1000); // seconds
  }, [creditBudget, creditsConsumed, elapsedMs]);

  const severity = getCostSeverity(creditsConsumed, creditBudget);
  const budgetPercent =
    creditBudget > 0
      ? Math.min(100, Math.round((creditsConsumed / creditBudget) * 100))
      : 0;

  const SEVERITY_TEXT_CLASS: Record<string, string> = {
    critical: "text-red-400",
    warning: "text-yellow-400",
    normal: "text-zinc-200",
  };

  const SEVERITY_BAR_CLASS: Record<string, string> = {
    critical: "bg-red-500",
    warning: "bg-yellow-500",
    normal: "bg-violet-500",
  };

  const creditsTextClass = SEVERITY_TEXT_CLASS[severity] ?? "text-zinc-200";
  const barClass = SEVERITY_BAR_CLASS[severity] ?? "bg-violet-500";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            aria-hidden="true"
            className="h-4 w-4 text-yellow-500"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path d="M10.75 10.818a2.608 2.608 0 0 1-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 0 1-1.279-.2 2.349 2.349 0 0 1-.96-.609 2.372 2.372 0 0 1-.535-.858A3.2 3.2 0 0 1 4.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 0 1 1.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766ZM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
          </svg>
          <span className="font-medium text-sm text-zinc-200">
            Cost Tracker
          </span>
        </div>
        {severity === "critical" && (
          <span className="rounded-full bg-red-500/10 px-2 py-0.5 font-medium text-[10px] text-red-400">
            Budget limit approaching
          </span>
        )}
        {severity === "warning" && (
          <span className="rounded-full bg-yellow-500/10 px-2 py-0.5 font-medium text-[10px] text-yellow-400">
            70% budget used
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Elapsed time */}
        <div className="flex flex-col gap-0.5 rounded-lg bg-zinc-950 px-3 py-2">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Elapsed
          </span>
          <span className="font-medium font-mono text-sm text-zinc-200">
            {startTime ? formatElapsed(elapsedMs) : "--:--"}
          </span>
        </div>

        {/* Tokens used */}
        <div className="flex flex-col gap-0.5 rounded-lg bg-zinc-950 px-3 py-2">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Tokens
          </span>
          <span className="font-medium font-mono text-sm text-zinc-200">
            {formatTokens(tokenUsage.total)}
          </span>
          <span className="text-[9px] text-zinc-600">
            {formatTokens(tokenUsage.tokensIn)} in /{" "}
            {formatTokens(tokenUsage.tokensOut)} out
          </span>
        </div>

        {/* Credits consumed */}
        <div className="flex flex-col gap-0.5 rounded-lg bg-zinc-950 px-3 py-2">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Credits Used
          </span>
          <span className={`font-medium font-mono text-sm ${creditsTextClass}`}>
            {creditsConsumed.toLocaleString()}
          </span>
        </div>

        {/* Estimated remaining */}
        <div className="flex flex-col gap-0.5 rounded-lg bg-zinc-950 px-3 py-2">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Est. Remaining
          </span>
          <span className="font-medium font-mono text-sm text-zinc-200">
            {estimatedRemaining === null
              ? "--"
              : formatElapsed(estimatedRemaining * 1000)}
          </span>
        </div>
      </div>

      {/* Credit budget progress bar */}
      {creditBudget > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-zinc-500">
              {creditsConsumed.toLocaleString()} /{" "}
              {creditBudget.toLocaleString()} credits
            </span>
            <span className="font-medium text-zinc-400">{budgetPercent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barClass}`}
              style={{ width: `${budgetPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Per-agent breakdown */}
      {agentBreakdown.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Cost by Agent
          </span>
          <div className="flex flex-col gap-1">
            {agentBreakdown.map((agent) => (
              <div
                className="flex items-center justify-between rounded-lg bg-zinc-950 px-3 py-1.5"
                key={agent.role}
              >
                <span className="text-xs text-zinc-300 capitalize">
                  {agent.role.replace(/_/g, " ")}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-zinc-500">
                    {formatTokens(agent.tokensIn + agent.tokensOut)} tokens
                  </span>
                  <span className="font-medium text-xs text-zinc-300">
                    {agent.credits} cr
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
