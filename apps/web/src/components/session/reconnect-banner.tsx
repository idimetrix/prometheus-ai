"use client";

import { useSessionReconnect } from "@/hooks/use-session-reconnect";

/**
 * Banner component that displays session reconnection status.
 * Shows at the top of the session view during reconnection and
 * auto-dismisses after successful reconnection.
 */
export function ReconnectBanner() {
  const { isReconnecting, hasReconnected, replayCount, error, dismiss } =
    useSessionReconnect();

  // Nothing to show
  if (!(isReconnecting || hasReconnected || error)) {
    return null;
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-between gap-2 border-red-900/50 border-b bg-red-950/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-red-500" />
          <span className="text-red-300 text-sm">{error}</span>
        </div>
        <button
          className="text-red-400 text-xs hover:text-red-300"
          onClick={dismiss}
          type="button"
        >
          Dismiss
        </button>
      </div>
    );
  }

  // Reconnecting state
  if (isReconnecting) {
    return (
      <div className="flex items-center gap-2 border-violet-900/50 border-b bg-violet-950/50 px-4 py-2">
        <svg
          aria-hidden="true"
          className="h-4 w-4 animate-spin text-violet-400"
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
        <span className="text-sm text-violet-300">
          Reconnecting to session...
        </span>
      </div>
    );
  }

  // Reconnected state with replay count
  if (hasReconnected) {
    return (
      <div className="flex items-center justify-between gap-2 border-green-900/50 border-b bg-green-950/50 px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-green-300 text-sm">
            {replayCount > 0
              ? `Reconnected! Replayed ${replayCount} event${replayCount === 1 ? "" : "s"}.`
              : "Reconnected to session."}
          </span>
        </div>
        <button
          className="text-green-400 text-xs hover:text-green-300"
          onClick={dismiss}
          type="button"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}
