"use client";

import type { SessionEvent } from "@/stores/session.store";

interface ErrorEventProps {
  event: SessionEvent;
  onRetry?: (eventId: string) => void;
}

export function ErrorEvent({ event, onRetry }: ErrorEventProps) {
  const message = (event.data.message as string) ?? "An unknown error occurred";
  const code = (event.data.code as string) ?? "";
  const stack = (event.data.stack as string) ?? "";
  const retryable = (event.data.retryable as boolean) ?? true;

  return (
    <div className="rounded-lg border border-red-800/50 bg-red-950/20 p-3">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20">
          <svg
            aria-hidden="true"
            className="h-3 w-3 text-red-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <span className="font-medium text-red-400 text-xs">Error</span>
        {code && (
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] text-red-500">
            {code}
          </span>
        )}
        {event.timestamp && (
          <span className="ml-auto text-[10px] text-zinc-600">
            {new Date(event.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        )}
      </div>

      <div className="text-red-300 text-xs leading-relaxed">{message}</div>

      {stack && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-red-400/80">
          {stack}
        </pre>
      )}

      {retryable && onRetry && (
        <button
          className="mt-2 rounded-lg border border-red-800/50 bg-red-950/50 px-3 py-1.5 font-medium text-red-400 text-xs transition-colors hover:bg-red-900/50"
          onClick={() => onRetry(event.id)}
          type="button"
        >
          Retry
        </button>
      )}
    </div>
  );
}
