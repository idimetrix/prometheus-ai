"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface AgentErrorContext {
  /** Which tool or step the agent was executing */
  failedStep?: string;
  /** Human-readable description of what the agent was trying to do */
  intent?: string;
  /** Raw error message from the agent */
  message: string;
  /** Whether this is a transient error (network timeout, etc.) */
  retryable?: boolean;
  /** Tool that failed, if applicable */
  toolName?: string;
}

interface SessionErrorRecoveryProps {
  /** Error context from the agent */
  error: AgentErrorContext;
  /** Callback to ask agent for help explaining the error */
  onAskForHelp?: () => void;
  /** Called when an automatic retry is initiated */
  onAutoRetry?: () => void;
  /** Callback to cancel the current task entirely */
  onCancel?: () => void;
  /** Callback to retry the last step */
  onRetry?: () => void;
  /** Callback to skip the failed step and continue */
  onSkip?: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MAX_AUTO_RETRIES = 3;
const AUTO_RETRY_DELAYS_MS = [2000, 5000, 10_000];

/* -------------------------------------------------------------------------- */
/*  Transient error detection                                                  */
/* -------------------------------------------------------------------------- */

function isTransientError(error: AgentErrorContext): boolean {
  if (error.retryable === true) {
    return true;
  }
  if (error.retryable === false) {
    return false;
  }

  const msg = error.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("503") ||
    msg.includes("502") ||
    msg.includes("429") ||
    msg.includes("rate limit")
  );
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function SessionErrorRecovery({
  error,
  onAskForHelp,
  onCancel,
  onAutoRetry,
  onRetry,
  onSkip,
}: SessionErrorRecoveryProps) {
  const [autoRetryCount, setAutoRetryCount] = useState(0);
  const [isAutoRetrying, setIsAutoRetrying] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transient = isTransientError(error);

  /** Perform an automatic retry for transient errors */
  const performAutoRetry = useCallback(() => {
    if (autoRetryCount >= MAX_AUTO_RETRIES) {
      setIsAutoRetrying(false);
      return;
    }

    const delay = AUTO_RETRY_DELAYS_MS[autoRetryCount] ?? 10_000;
    logger.info(
      `[SessionErrorRecovery] Auto-retry ${autoRetryCount + 1}/${MAX_AUTO_RETRIES} in ${delay}ms`
    );

    setIsAutoRetrying(true);
    timerRef.current = setTimeout(() => {
      setAutoRetryCount((prev) => prev + 1);
      onAutoRetry?.();
      onRetry?.();
    }, delay);
  }, [autoRetryCount, onAutoRetry, onRetry]);

  /** Start auto-retry on mount if transient */
  useEffect(() => {
    if (transient && autoRetryCount < MAX_AUTO_RETRIES) {
      performAutoRetry();
    }
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [transient, autoRetryCount, performAutoRetry]);

  const showManualOptions =
    !isAutoRetrying || autoRetryCount >= MAX_AUTO_RETRIES;

  return (
    <div className="rounded-xl border border-red-500/20 bg-zinc-900/80 p-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
          <svg
            aria-hidden="true"
            className="h-4 w-4 text-red-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm text-zinc-200">
            Agent encountered an error
          </h3>
          <p className="mt-1 text-sm text-zinc-400">{error.message}</p>
        </div>
      </div>

      {/* Auto-retry status */}
      {isAutoRetrying && autoRetryCount < MAX_AUTO_RETRIES && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-yellow-500/5 px-3 py-2 text-xs text-yellow-400">
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin"
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
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              fill="currentColor"
            />
          </svg>
          Automatically retrying ({autoRetryCount + 1}/{MAX_AUTO_RETRIES})...
        </div>
      )}

      {autoRetryCount >= MAX_AUTO_RETRIES && (
        <div className="mt-3 rounded-lg bg-red-500/5 px-3 py-2 text-red-400 text-xs">
          Automatic retries exhausted ({MAX_AUTO_RETRIES}/{MAX_AUTO_RETRIES}).
          Please choose an action below.
        </div>
      )}

      {/* Error context details */}
      {(error.toolName || error.failedStep || error.intent) && (
        <div className="mt-3">
          <button
            className="flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
            onClick={() => setShowDetails(!showDetails)}
            type="button"
          >
            <svg
              aria-hidden="true"
              className={`h-3 w-3 transition-transform ${showDetails ? "rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                d="m8.25 4.5 7.5 7.5-7.5 7.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Error details
          </button>

          {showDetails && (
            <div className="mt-2 space-y-1.5 rounded-lg bg-zinc-950 p-3">
              {error.toolName && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-600">Tool:</span>
                  <span className="font-mono text-zinc-400">
                    {error.toolName}
                  </span>
                </div>
              )}
              {error.failedStep && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-600">Step:</span>
                  <span className="text-zinc-400">{error.failedStep}</span>
                </div>
              )}
              {error.intent && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-600">Intent:</span>
                  <span className="text-zinc-400">{error.intent}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Manual action buttons */}
      {showManualOptions && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {onRetry && (
            <button
              className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-white text-xs transition-colors hover:bg-violet-700"
              onClick={() => {
                setAutoRetryCount(0);
                setIsAutoRetrying(false);
                onRetry();
              }}
              type="button"
            >
              Retry last step
            </button>
          )}
          {onSkip && (
            <button
              className="rounded-lg border border-zinc-700 px-3 py-1.5 font-medium text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
              onClick={onSkip}
              type="button"
            >
              Skip and continue
            </button>
          )}
          {onCancel && (
            <button
              className="rounded-lg border border-zinc-700 px-3 py-1.5 font-medium text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
              onClick={onCancel}
              type="button"
            >
              Cancel task
            </button>
          )}
          {onAskForHelp && (
            <button
              className="rounded-lg border border-zinc-700 px-3 py-1.5 font-medium text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
              onClick={onAskForHelp}
              type="button"
            >
              Ask for help
            </button>
          )}
        </div>
      )}
    </div>
  );
}
