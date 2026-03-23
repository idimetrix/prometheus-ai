"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerInfo {
  currentOutput?: string;
  currentTask?: string;
  elapsedMs: number;
  estimatedTotalMs?: number;
  filesModified: string[];
  id: string;
  role: string;
  status: "idle" | "working" | "paused" | "completed" | "failed";
  tokensIn?: number;
  tokensOut?: number;
  tokensUsed: number;
}

interface WorkerCardProps {
  onKill?: (workerId: string) => void;
  onPause?: (workerId: string) => void;
  onReassign?: (workerId: string) => void;
  onResume?: (workerId: string) => void;
  worker: WorkerInfo;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_INDICATORS: Record<string, { color: string; label: string }> = {
  idle: { color: "bg-zinc-500", label: "Idle" },
  working: { color: "bg-green-500 animate-pulse", label: "Working" },
  paused: { color: "bg-yellow-500", label: "Paused" },
  completed: { color: "bg-blue-500", label: "Completed" },
  failed: { color: "bg-red-500", label: "Failed" },
};

const ROLE_COLORS: Record<string, string> = {
  orchestrator: "bg-violet-500/20 text-violet-400",
  architect: "bg-indigo-500/20 text-indigo-400",
  "frontend-coder": "bg-cyan-500/20 text-cyan-400",
  "backend-coder": "bg-green-500/20 text-green-400",
  tester: "bg-pink-500/20 text-pink-400",
  reviewer: "bg-amber-500/20 text-amber-400",
  deployer: "bg-emerald-500/20 text-emerald-400",
  security: "bg-red-500/20 text-red-400",
};

const MAX_MINI_TERMINAL_LINES = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toString();
}

function getProgressBarColor(percentage: number): string {
  if (percentage >= 90) {
    return "bg-green-500";
  }
  if (percentage >= 50) {
    return "bg-blue-500";
  }
  return "bg-violet-500";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressBar({
  elapsedMs,
  estimatedTotalMs,
}: {
  elapsedMs: number;
  estimatedTotalMs: number;
}) {
  const percentage = Math.min(
    100,
    (elapsedMs / Math.max(estimatedTotalMs, 1)) * 100
  );
  const barColor = getProgressBarColor(percentage);

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[9px]">
        <span className="text-zinc-500">Progress</span>
        <span className="font-mono text-zinc-400">
          {Math.round(percentage)}%
        </span>
      </div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function MiniTerminal({ output }: { output: string }) {
  const lines = useMemo(() => {
    const allLines = output.split("\n");
    return allLines.slice(-MAX_MINI_TERMINAL_LINES);
  }, [output]);

  return (
    <div className="mt-2 overflow-hidden rounded bg-zinc-950 p-2">
      <div className="mb-1 flex items-center gap-1 text-[9px] text-zinc-600">
        <svg
          aria-hidden="true"
          className="h-2.5 w-2.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Output
      </div>
      <pre className="font-mono text-[10px] text-zinc-500 leading-relaxed">
        {lines.map((line, idx) => (
          <div className="truncate" key={`line-${String(idx)}`}>
            {line}
          </div>
        ))}
      </pre>
    </div>
  );
}

function ElapsedTimer({ initialMs }: { initialMs: number }) {
  const [displayMs, setDisplayMs] = useState(initialMs);

  useEffect(() => {
    setDisplayMs(initialMs);
  }, [initialMs]);

  useEffect(() => {
    const interval = setInterval(() => {
      setDisplayMs((prev) => prev + 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="font-mono text-xs text-zinc-300">
      {formatElapsed(displayMs)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function WorkerCard({
  worker,
  onPause,
  onResume,
  onKill,
  onReassign,
}: WorkerCardProps) {
  const statusInfo: { color: string; label: string } = STATUS_INDICATORS[
    worker.status
  ] ?? { color: "bg-zinc-500", label: "Idle" };
  const roleColor = ROLE_COLORS[worker.role] ?? "bg-zinc-500/20 text-zinc-400";

  const handlePause = useCallback(() => {
    onPause?.(worker.id);
  }, [onPause, worker.id]);

  const handleResume = useCallback(() => {
    onResume?.(worker.id);
  }, [onResume, worker.id]);

  const handleKill = useCallback(() => {
    onKill?.(worker.id);
  }, [onKill, worker.id]);

  const handleReassign = useCallback(() => {
    onReassign?.(worker.id);
  }, [onReassign, worker.id]);

  const tokensIn = worker.tokensIn ?? 0;
  const tokensOut = worker.tokensOut ?? 0;

  return (
    <div className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:border-zinc-700">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-lg px-2 py-1 font-medium text-xs ${roleColor}`}
          >
            {worker.role}
          </span>
          <span className="font-mono text-[10px] text-zinc-600">
            {worker.id.slice(0, 8)}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${statusInfo.color}`} />
          <span className="text-[10px] text-zinc-500">{statusInfo.label}</span>
        </div>
      </div>

      {/* Current task */}
      {worker.currentTask && (
        <div className="mt-3 rounded-lg bg-zinc-800/50 px-3 py-2">
          <div className="text-[10px] text-zinc-600">Current Task</div>
          <div className="mt-0.5 truncate text-xs text-zinc-300">
            {worker.currentTask}
          </div>
        </div>
      )}

      {/* Progress bar */}
      {worker.estimatedTotalMs && worker.status === "working" && (
        <ProgressBar
          elapsedMs={worker.elapsedMs}
          estimatedTotalMs={worker.estimatedTotalMs}
        />
      )}

      {/* Mini terminal showing last 5 lines of output */}
      {worker.currentOutput && worker.status === "working" && (
        <MiniTerminal output={worker.currentOutput} />
      )}

      {/* Token counter and metrics */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <div className="text-[9px] text-zinc-600">In</div>
            <div className="font-mono text-[10px] text-zinc-400">
              {formatTokens(tokensIn)}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-zinc-600">Out</div>
            <div className="font-mono text-[10px] text-zinc-400">
              {formatTokens(tokensOut)}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-zinc-600">Total</div>
            <div className="font-mono text-[10px] text-zinc-300">
              {formatTokens(worker.tokensUsed)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div>
            <div className="text-[9px] text-zinc-600">Files</div>
            <div className="font-mono text-[10px] text-zinc-400">
              {worker.filesModified.length}
            </div>
          </div>
          <div>
            <div className="text-[9px] text-zinc-600">Elapsed</div>
            {worker.status === "working" ? (
              <ElapsedTimer initialMs={worker.elapsedMs} />
            ) : (
              <div className="font-mono text-xs text-zinc-300">
                {formatElapsed(worker.elapsedMs)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      {(worker.status === "working" || worker.status === "paused") && (
        <div className="mt-3 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          {worker.status === "working" && onPause && (
            <button
              className="flex-1 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-2 py-1 font-medium text-[10px] text-yellow-300 hover:bg-yellow-500/20"
              onClick={handlePause}
              type="button"
            >
              Pause
            </button>
          )}
          {worker.status === "paused" && onResume && (
            <button
              className="flex-1 rounded-lg border border-green-500/30 bg-green-500/10 px-2 py-1 font-medium text-[10px] text-green-300 hover:bg-green-500/20"
              onClick={handleResume}
              type="button"
            >
              Resume
            </button>
          )}
          {onKill && (
            <button
              className="flex-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 font-medium text-[10px] text-red-300 hover:bg-red-500/20"
              onClick={handleKill}
              type="button"
            >
              Stop
            </button>
          )}
          {onReassign && (
            <button
              className="flex-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-1 font-medium text-[10px] text-violet-300 hover:bg-violet-500/20"
              onClick={handleReassign}
              type="button"
            >
              Reassign
            </button>
          )}
        </div>
      )}
    </div>
  );
}
