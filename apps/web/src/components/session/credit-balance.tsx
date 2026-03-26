"use client";

import { useEffect, useMemo, useState } from "react";
import { useDashboardStore } from "@/stores/dashboard.store";
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
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Real-time credit balance display with time tracking and token usage.
 * Enhanced for DEV-007 Devin parity: shows wall-clock time, tokens,
 * estimated cost, and a visual credit budget progress bar.
 */
export function CreditBalance() {
  const { events, taskProgress, agents } = useSessionStore();
  const { creditBalance } = useDashboardStore();

  // ---- Credits from events ----
  const latestCreditEvent = [...events]
    .reverse()
    .find((e) => e.type === "credit_update");

  const balance = latestCreditEvent
    ? (latestCreditEvent.data.balance as number)
    : creditBalance;

  const sessionCost = latestCreditEvent
    ? ((latestCreditEvent.data.sessionCost as number) ?? 0)
    : 0;

  // ---- Live elapsed time ----
  const [elapsedMs, setElapsedMs] = useState(0);

  const startTime = useMemo(() => {
    if (taskProgress?.startedAt) {
      return new Date(taskProgress.startedAt).getTime();
    }
    // Fall back to the first event timestamp
    const first = events[0];
    return first ? new Date(first.timestamp).getTime() : null;
  }, [taskProgress?.startedAt, events]);

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

  // ---- Token aggregation ----
  const tokenUsage = useMemo(() => {
    let tokensIn = 0;
    let tokensOut = 0;

    // Sum from agent list first (most accurate)
    for (const agent of agents) {
      tokensIn += agent.tokensIn;
      tokensOut += agent.tokensOut;
    }

    // If no agents have token data, fall back to events
    if (tokensIn === 0 && tokensOut === 0) {
      for (const event of events) {
        if (event.type === "credit_update" || event.type === "agent_output") {
          tokensIn += (event.data.tokensIn as number) ?? 0;
          tokensOut += (event.data.tokensOut as number) ?? 0;
        }
      }
    }

    return { tokensIn, tokensOut, total: tokensIn + tokensOut };
  }, [events, agents]);

  // ---- Cost breakdown by agent role ----
  const agentCosts = useMemo(() => {
    if (agents.length === 0) {
      return [];
    }
    return agents
      .filter((a) => a.tokensIn > 0 || a.tokensOut > 0)
      .map((a) => ({
        role: a.role,
        credits: Math.ceil((a.tokensIn + a.tokensOut) / 1000),
      }));
  }, [agents]);

  // ---- Credit budget progress ----
  const budgetTotal = balance + sessionCost;
  const budgetPercent =
    budgetTotal > 0
      ? Math.min(100, Math.round((sessionCost / budgetTotal) * 100))
      : 0;

  const isLowBalance = balance > 0 && balance < 10;

  return (
    <div className="flex flex-col gap-2">
      {/* Main balance row */}
      <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5">
        {/* Credits icon */}
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 text-yellow-500"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M10.75 10.818a2.608 2.608 0 0 1-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 0 1-1.279-.2 2.349 2.349 0 0 1-.96-.609 2.372 2.372 0 0 1-.535-.858A3.2 3.2 0 0 1 4.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 0 1 1.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766ZM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
        </svg>

        <div className="flex items-baseline gap-1.5">
          <span
            className={`font-medium text-xs ${isLowBalance ? "text-red-400" : "text-zinc-200"}`}
          >
            {balance.toLocaleString()}
          </span>
          <span className="text-[10px] text-zinc-500">credits</span>
        </div>

        {sessionCost > 0 && (
          <span className="text-[10px] text-zinc-600">
            (-{sessionCost.toLocaleString()} this session)
          </span>
        )}

        {/* Elapsed time */}
        {startTime && (
          <>
            <span className="text-zinc-700">|</span>
            <span className="font-mono text-[10px] text-zinc-400">
              {formatElapsed(elapsedMs)}
            </span>
          </>
        )}

        {/* Token count */}
        {tokenUsage.total > 0 && (
          <>
            <span className="text-zinc-700">|</span>
            <span className="text-[10px] text-zinc-500">
              {formatTokens(tokenUsage.total)} tokens
            </span>
          </>
        )}
      </div>

      {/* Credit budget progress bar */}
      {sessionCost > 0 && budgetTotal > 0 && (
        <div className="flex items-center gap-2 px-1">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isLowBalance ? "bg-red-500" : "bg-violet-500"
              }`}
              style={{ width: `${budgetPercent}%` }}
            />
          </div>
          <span className="text-[9px] text-zinc-600">{budgetPercent}%</span>
        </div>
      )}

      {/* Per-agent cost breakdown (compact inline) */}
      {agentCosts.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {agentCosts.map((ac) => (
            <span
              className="rounded-full bg-zinc-800 px-2 py-0.5 text-[9px] text-zinc-500"
              key={ac.role}
            >
              {ac.role.replace(/_/g, " ")}: {ac.credits}cr
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
