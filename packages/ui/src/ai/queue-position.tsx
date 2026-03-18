import { cn } from "../lib/utils";

interface QueuePositionProps {
  className?: string;
  estimatedWaitSeconds: number;
  position: number;
  totalInQueue: number;
}

export function QueuePosition({
  position,
  estimatedWaitSeconds,
  totalInQueue,
  className,
}: QueuePositionProps) {
  const formatWait = (seconds: number): string => {
    if (seconds < 60) {
      return "< 1 min";
    }
    if (seconds < 3600) {
      return `~${Math.ceil(seconds / 60)} min`;
    }
    return `~${Math.ceil(seconds / 3600)}h`;
  };

  if (position === 0) {
    return (
      <div className={cn("flex items-center gap-2 text-sm", className)}>
        <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
        <span className="font-medium text-green-600">Processing...</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
        <span className="font-medium text-sm text-yellow-600">
          Queue Position: {position}
        </span>
      </div>
      <span className="text-muted-foreground text-xs">
        Est. wait: {formatWait(estimatedWaitSeconds)}
      </span>
      <span className="text-muted-foreground text-xs">
        ({totalInQueue} in queue)
      </span>
    </div>
  );
}
