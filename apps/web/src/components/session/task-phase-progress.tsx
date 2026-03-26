"use client";

import { useCallback, useState } from "react";
import type {
  PhaseInfo,
  TaskPhase,
  TaskProgress,
} from "@/stores/session.store";
import { useSessionStore } from "@/stores/session.store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PHASE_ORDER: TaskPhase[] = [
  "discovery",
  "planning",
  "coding",
  "testing",
  "review",
  "deploy",
  "complete",
];

const PHASE_LABELS: Record<TaskPhase, string> = {
  discovery: "Discovery",
  planning: "Planning",
  coding: "Coding",
  testing: "Testing",
  review: "Review",
  deploy: "Deploy",
  complete: "Complete",
};

const PHASE_DESCRIPTIONS: Record<TaskPhase, string> = {
  discovery: "Gathering requirements and analyzing the codebase",
  planning: "Creating an implementation plan",
  coding: "Writing and modifying code",
  testing: "Running tests and validating changes",
  review: "Reviewing code quality and correctness",
  deploy: "Deploying changes if applicable",
  complete: "Task finished",
};

const PHASE_ICONS: Record<TaskPhase, string> = {
  discovery:
    "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z",
  planning:
    "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z",
  coding:
    "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5",
  testing:
    "M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5",
  review:
    "M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  deploy:
    "M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z",
  complete: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _getPhaseStatusColor(status: PhaseInfo["status"]): string {
  switch (status) {
    case "completed":
      return "bg-green-500";
    case "active":
      return "bg-violet-500 animate-pulse";
    case "skipped":
      return "bg-zinc-600";
    default:
      return "bg-zinc-700";
  }
}

function getPhaseTextColor(status: PhaseInfo["status"]): string {
  switch (status) {
    case "completed":
      return "text-green-400";
    case "active":
      return "text-violet-400";
    case "skipped":
      return "text-zinc-500";
    default:
      return "text-zinc-600";
  }
}

function getPhaseConnectorColor(status: PhaseInfo["status"]): string {
  switch (status) {
    case "completed":
      return "bg-green-500/50";
    case "active":
      return "bg-violet-500/30";
    default:
      return "bg-zinc-800";
  }
}

function formatTimeRemaining(ms: number | null): string {
  if (ms === null || ms <= 0) {
    return "";
  }
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `~${seconds}s remaining`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes}m remaining`;
}

function formatDuration(start: string, end?: string): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const diff = endMs - startMs;
  if (diff < 1000) {
    return `${diff}ms`;
  }
  if (diff < 60_000) {
    return `${(diff / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(diff / 60_000)}m ${Math.floor((diff % 60_000) / 1000)}s`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PhaseStepIcon({
  phase,
  status,
}: {
  phase: TaskPhase;
  status: PhaseInfo["status"];
}) {
  if (status === "completed") {
    return (
      <svg
        aria-hidden="true"
        className="h-4 w-4 text-green-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
      >
        <path
          d="M4.5 12.75l6 6 9-13.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (status === "active") {
    return (
      <svg
        aria-hidden="true"
        className="h-4 w-4 text-violet-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path
          d={PHASE_ICONS[phase]}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 text-zinc-600"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        d={PHASE_ICONS[phase]}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PhaseDetail({ phase }: { phase: PhaseInfo }) {
  return (
    <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-900/50 p-2.5 text-[11px]">
      <p className="text-zinc-400">{PHASE_DESCRIPTIONS[phase.phase]}</p>
      {phase.message && <p className="mt-1 text-zinc-300">{phase.message}</p>}
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-zinc-500">
        {phase.startedAt && (
          <span>
            Started:{" "}
            {new Date(phase.startedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
        {phase.startedAt && (
          <span>
            Duration: {formatDuration(phase.startedAt, phase.completedAt)}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function TaskPhaseProgress() {
  const taskProgress = useSessionStore((s) => s.taskProgress);
  const [expandedPhase, setExpandedPhase] = useState<TaskPhase | null>(null);

  const togglePhase = useCallback((phase: TaskPhase) => {
    setExpandedPhase((prev) => (prev === phase ? null : phase));
  }, []);

  if (!taskProgress) {
    return null;
  }

  const completedCount = taskProgress.phases.filter(
    (p) => p.status === "completed"
  ).length;
  const totalPhases = taskProgress.phases.length;
  const progressPercent = Math.round(
    (completedCount / Math.max(totalPhases, 1)) * 100
  );

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium text-xs text-zinc-300">
            Task Progress
          </span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
            {completedCount}/{totalPhases} phases
          </span>
        </div>
        <div className="flex items-center gap-3">
          {taskProgress.estimatedTimeRemaining !== null &&
            taskProgress.estimatedTimeRemaining > 0 && (
              <span className="text-[10px] text-zinc-500">
                {formatTimeRemaining(taskProgress.estimatedTimeRemaining)}
              </span>
            )}
          <span className="font-mono text-[10px] text-zinc-400">
            {progressPercent}%
          </span>
        </div>
      </div>

      {/* Overall progress bar */}
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-violet-500 transition-all duration-500"
          style={{ width: `${taskProgress.overallProgress}%` }}
        />
      </div>

      {/* Phase stepper */}
      <div className="mt-3 flex items-start gap-0">
        {taskProgress.phases.map((phase, i) => {
          const isLast = i === taskProgress.phases.length - 1;
          const isExpanded = expandedPhase === phase.phase;

          return (
            <div
              className="flex min-w-0 flex-1 flex-col items-center"
              key={phase.phase}
            >
              <div className="flex w-full items-center">
                {/* Connector before (except first) */}
                {i > 0 && (
                  <div
                    className={`h-0.5 flex-1 ${getPhaseConnectorColor(
                      (taskProgress.phases[i - 1]
                        ?.status as PhaseInfo["status"]) ?? "pending"
                    )}`}
                  />
                )}

                {/* Phase dot/icon */}
                <button
                  aria-expanded={isExpanded}
                  aria-label={`${PHASE_LABELS[phase.phase]} phase: ${phase.status}`}
                  className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors ${getPhaseStepClass(phase.status)}`}
                  onClick={() => togglePhase(phase.phase)}
                  type="button"
                >
                  <PhaseStepIcon phase={phase.phase} status={phase.status} />
                </button>

                {/* Connector after (except last) */}
                {!isLast && (
                  <div
                    className={`h-0.5 flex-1 ${getPhaseConnectorColor(
                      phase.status
                    )}`}
                  />
                )}
              </div>

              {/* Label */}
              <span
                className={`mt-1.5 text-center text-[10px] leading-tight ${getPhaseTextColor(
                  phase.status
                )}`}
              >
                {PHASE_LABELS[phase.phase]}
              </span>

              {/* Expanded detail */}
              {isExpanded && <PhaseDetail phase={phase} />}
            </div>
          );
        })}
      </div>

      {/* Current phase message */}
      {taskProgress.message && (
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-violet-400" />
          <span className="truncate text-zinc-400">{taskProgress.message}</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact variant for header bar
// ---------------------------------------------------------------------------

export function TaskPhaseProgressCompact() {
  const taskProgress = useSessionStore((s) => s.taskProgress);

  if (!taskProgress) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5">
      {taskProgress.phases.map((phase) => (
        <div
          className={`h-1.5 rounded-full transition-all duration-300 ${getPhaseBarClass(phase.status)}`}
          key={phase.phase}
          title={`${PHASE_LABELS[phase.phase]}: ${phase.status}`}
        />
      ))}
    </div>
  );
}

function getPhaseStepClass(status: string): string {
  if (status === "completed") {
    return "border-green-500/30 bg-green-500/10";
  }
  if (status === "active") {
    return "border-violet-500/30 bg-violet-500/10";
  }
  return "border-zinc-700 bg-zinc-900";
}

function getPhaseBarClass(status: string): string {
  if (status === "completed") {
    return "w-4 bg-green-500";
  }
  if (status === "active") {
    return "w-6 animate-pulse bg-violet-500";
  }
  return "w-2 bg-zinc-700";
}

// ---------------------------------------------------------------------------
// Helper to create default phases
// ---------------------------------------------------------------------------

export function createDefaultPhases(): PhaseInfo[] {
  return PHASE_ORDER.map((phase) => ({
    phase,
    status: "pending" as const,
    progress: 0,
  }));
}

export function createDefaultTaskProgress(taskId: string): TaskProgress {
  return {
    taskId,
    currentPhase: "discovery",
    overallProgress: 0,
    message: "Starting task...",
    phases: createDefaultPhases(),
    estimatedTimeRemaining: null,
    confidenceScore: 0,
    creditsConsumed: 0,
    agentRole: undefined,
    startedAt: new Date().toISOString(),
  };
}
