import * as React from "react";
import { cn } from "../lib/utils";

interface QueuePositionProps {
  position: number;
  estimatedWaitSeconds: number;
  totalInQueue: number;
  className?: string;
}

export function QueuePosition({ position, estimatedWaitSeconds, totalInQueue, className }: QueuePositionProps) {
  const formatWait = (seconds: number): string => {
    if (seconds < 60) return `< 1 min`;
    if (seconds < 3600) return `~${Math.ceil(seconds / 60)} min`;
    return `~${Math.ceil(seconds / 3600)}h`;
  };

  if (position === 0) {
    return (
      <div className={cn("flex items-center gap-2 text-sm", className)}>
        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        <span className="text-green-600 font-medium">Processing...</span>
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-3 rounded-lg border bg-yellow-500/5 border-yellow-500/20 px-3 py-2", className)}>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
        <span className="text-sm font-medium text-yellow-600">Queue Position: {position}</span>
      </div>
      <span className="text-xs text-muted-foreground">
        Est. wait: {formatWait(estimatedWaitSeconds)}
      </span>
      <span className="text-xs text-muted-foreground">
        ({totalInQueue} in queue)
      </span>
    </div>
  );
}
