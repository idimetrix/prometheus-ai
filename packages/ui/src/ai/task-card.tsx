import { cn } from "../lib/utils";

interface TaskCardProps {
  agentRole?: string;
  className?: string;
  creditsUsed?: number;
  duration?: string;
  id: string;
  status:
    | "pending"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";
  title: string;
}

const STATUS_BADGES: Record<
  TaskCardProps["status"],
  { color: string; label: string }
> = {
  pending: { color: "bg-zinc-500", label: "Pending" },
  queued: { color: "bg-yellow-500", label: "Queued" },
  running: { color: "bg-blue-500 animate-pulse", label: "Running" },
  completed: { color: "bg-green-500", label: "Completed" },
  failed: { color: "bg-red-500", label: "Failed" },
  cancelled: { color: "bg-zinc-400", label: "Cancelled" },
};

export function TaskCard({
  id: _id,
  title,
  status,
  agentRole,
  creditsUsed,
  duration,
  className,
}: TaskCardProps) {
  const badge = STATUS_BADGES[status];

  return (
    <div className={cn("space-y-2 rounded-lg border p-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 truncate font-medium text-sm">{title}</h4>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", badge.color)} />
          <span className="text-muted-foreground text-xs">{badge.label}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-muted-foreground text-xs">
        {agentRole && (
          <span className="rounded bg-muted px-1.5 py-0.5">{agentRole}</span>
        )}
        {creditsUsed !== undefined && <span>{creditsUsed} credits</span>}
        {duration && <span>{duration}</span>}
      </div>
    </div>
  );
}
