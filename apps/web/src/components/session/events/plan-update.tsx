"use client";

import type { PlanStep, SessionEvent } from "@/stores/session.store";

interface PlanUpdateProps {
  event: SessionEvent;
}

function StepStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "done":
    case "completed":
      return (
        <div className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500/20">
          <svg
            className="h-2.5 w-2.5 text-green-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path
              d="m4.5 12.75 6 6 9-13.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      );
    case "running":
    case "in_progress":
      return (
        <div className="flex h-4 w-4 items-center justify-center rounded-full bg-violet-500/20">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
        </div>
      );
    case "failed":
      return (
        <div className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500/20">
          <svg
            className="h-2.5 w-2.5 text-red-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M6 18 18 6M6 6l12 12"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      );
    default:
      return (
        <div className="flex h-4 w-4 items-center justify-center rounded-full border border-zinc-700">
          <div className="h-1 w-1 rounded-full bg-zinc-600" />
        </div>
      );
  }
}

export function PlanUpdate({ event }: PlanUpdateProps) {
  const steps = (event.data.steps as PlanStep[]) ?? [];
  const completedCount = steps.filter(
    (s) => s.status === "done" || s.status === "completed"
  ).length;

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            className="h-3.5 w-3.5 text-zinc-500"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="font-medium text-xs text-zinc-400">Plan</span>
        </div>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
          {completedCount}/{steps.length}
        </span>
      </div>

      {/* Progress bar */}
      {steps.length > 0 && (
        <div className="mb-3 h-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-violet-500 transition-all duration-500"
            style={{ width: `${(completedCount / steps.length) * 100}%` }}
          />
        </div>
      )}

      <div className="space-y-1">
        {steps.map((step, i) => (
          <div
            className={`flex items-start gap-2 rounded px-2 py-1.5 ${
              step.status === "running" || step.status === "in_progress"
                ? "bg-violet-500/5"
                : ""
            }`}
            key={step.id}
          >
            <StepStatusIcon status={step.status} />
            <div className="min-w-0 flex-1">
              <span
                className={`text-xs ${
                  step.status === "done" || step.status === "completed"
                    ? "text-zinc-500 line-through"
                    : step.status === "running" || step.status === "in_progress"
                      ? "font-medium text-violet-300"
                      : "text-zinc-300"
                }`}
              >
                {i + 1}. {step.title}
              </span>
              {step.description && (
                <div className="mt-0.5 text-[10px] text-zinc-600">
                  {step.description}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
