"use client";

interface BlockerCardProps {
  agentRole: string;
  consecutiveFailures: number;
  onProvideInput?: (input: string) => void;
  onRetry?: () => void;
  onSkip?: () => void;
  reason: string;
}

export function BlockerCard({
  agentRole,
  reason,
  consecutiveFailures,
  onRetry,
  onSkip,
  onProvideInput,
}: BlockerCardProps) {
  return (
    <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="h-2 w-2 animate-pulse rounded-full bg-orange-500" />
        <h4 className="font-semibold text-orange-300 text-sm">Agent Blocked</h4>
        <span className="ml-auto text-xs text-zinc-500">{agentRole}</span>
      </div>

      <p className="mb-3 text-sm text-zinc-300">{reason}</p>

      <div className="mb-2 text-xs text-zinc-500">
        Failed {consecutiveFailures} consecutive times
      </div>

      <div className="flex gap-2">
        {onRetry && (
          <button
            className="rounded bg-orange-600 px-3 py-1.5 font-medium text-white text-xs hover:bg-orange-500"
            onClick={onRetry}
            type="button"
          >
            Retry
          </button>
        )}
        {onProvideInput && (
          <button
            className="rounded bg-indigo-600 px-3 py-1.5 font-medium text-white text-xs hover:bg-indigo-500"
            onClick={() => onProvideInput("")}
            type="button"
          >
            Provide Input
          </button>
        )}
        {onSkip && (
          <button
            className="rounded bg-zinc-700 px-3 py-1.5 font-medium text-xs text-zinc-300 hover:bg-zinc-600"
            onClick={onSkip}
            type="button"
          >
            Skip
          </button>
        )}
      </div>
    </div>
  );
}
