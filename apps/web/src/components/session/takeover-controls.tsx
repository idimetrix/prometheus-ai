"use client";

import { useCallback, useState } from "react";

interface TakeoverControlsProps {
  controllingUserId?: string;
  currentUserId: string;
  isHumanControlled: boolean;
  onRelease: (context?: string) => void;
  onTakeover: () => void;
  onUndoLastAction?: () => void;
  sessionId: string;
}

/**
 * Human-in-the-loop controls for taking over and releasing
 * control from the agent during a session.
 */
export function TakeoverControls({
  sessionId,
  isHumanControlled,
  currentUserId,
  controllingUserId,
  onTakeover,
  onRelease,
  onUndoLastAction,
}: TakeoverControlsProps) {
  const [releaseContext, setReleaseContext] = useState("");
  const [showReleaseForm, setShowReleaseForm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const isCurrentUserControlling = controllingUserId === currentUserId;
  const isOtherUserControlling = isHumanControlled && !isCurrentUserControlling;

  const handleTakeover = useCallback(async () => {
    setIsLoading(true);
    try {
      onTakeover();
    } finally {
      setIsLoading(false);
    }
  }, [onTakeover]);

  const handleRelease = useCallback(async () => {
    setIsLoading(true);
    try {
      onRelease(releaseContext || undefined);
      setReleaseContext("");
      setShowReleaseForm(false);
    } finally {
      setIsLoading(false);
    }
  }, [onRelease, releaseContext]);

  if (isOtherUserControlling) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 dark:border-yellow-800 dark:bg-yellow-900/20">
        <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
        <span className="text-xs text-yellow-700 dark:text-yellow-400">
          Another user has control
        </span>
      </div>
    );
  }

  if (isCurrentUserControlling) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-900/20">
          <div className="h-2 w-2 rounded-full bg-blue-500" />
          <span className="font-medium text-blue-700 text-xs dark:text-blue-400">
            You have control
          </span>

          <div className="ml-auto flex items-center gap-1">
            {onUndoLastAction && (
              <button
                className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                onClick={onUndoLastAction}
              >
                Undo
              </button>
            )}

            {showReleaseForm ? (
              <div className="flex items-center gap-1">
                <input
                  className="w-48 rounded border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                  onChange={(e) => setReleaseContext(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRelease()}
                  placeholder="Context for agent..."
                  type="text"
                  value={releaseContext}
                />
                <button
                  className="rounded bg-green-500 px-2 py-1 text-white text-xs hover:bg-green-600 disabled:opacity-50"
                  disabled={isLoading}
                  onClick={handleRelease}
                >
                  Release
                </button>
                <button
                  className="rounded bg-zinc-200 px-2 py-1 text-xs hover:bg-zinc-300 dark:bg-zinc-700"
                  onClick={() => setShowReleaseForm(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="rounded bg-green-100 px-2 py-1 text-green-700 text-xs hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400"
                onClick={() => setShowReleaseForm(true)}
              >
                Release Control
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Not controlled — show takeover button
  return (
    <button
      className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-1.5 text-xs hover:bg-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
      disabled={isLoading}
      onClick={handleTakeover}
    >
      <span>Take Control</span>
    </button>
  );
}
