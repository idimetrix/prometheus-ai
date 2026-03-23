"use client";

import { useSessionStore } from "@/stores/session.store";

/**
 * Real-time queue position tracker.
 * Shows the current position in the task queue, or hides when not queued.
 */
export function QueuePosition() {
  const { queuePosition, status } = useSessionStore();

  // Only show when task is actually queued
  if (queuePosition <= 0 || (status !== "queued" && status !== null)) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5">
      <div className="flex h-4 w-4 items-center justify-center">
        <svg
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin text-violet-400"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            fill="currentColor"
          />
        </svg>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-medium text-xs text-zinc-200">
          #{queuePosition}
        </span>
        <span className="text-[10px] text-zinc-500">in queue</span>
      </div>
      {queuePosition === 1 && (
        <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400">
          Next up
        </span>
      )}
    </div>
  );
}
