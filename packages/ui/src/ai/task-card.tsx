import * as React from "react";
import { cn } from "../lib/utils";

interface TaskCardProps {
  id: string;
  title: string;
  status: "pending" | "queued" | "running" | "completed" | "failed" | "cancelled";
  agentRole?: string;
  creditsUsed?: number;
  duration?: string;
  className?: string;
}

const STATUS_BADGES: Record<TaskCardProps["status"], { color: string; label: string }> = {
  pending: { color: "bg-zinc-500", label: "Pending" },
  queued: { color: "bg-yellow-500", label: "Queued" },
  running: { color: "bg-blue-500 animate-pulse", label: "Running" },
  completed: { color: "bg-green-500", label: "Completed" },
  failed: { color: "bg-red-500", label: "Failed" },
  cancelled: { color: "bg-zinc-400", label: "Cancelled" },
};

export function TaskCard({ id, title, status, agentRole, creditsUsed, duration, className }: TaskCardProps) {
  const badge = STATUS_BADGES[status];

  return (
    <div className={cn("rounded-lg border p-3 space-y-2", className)}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium truncate flex-1">{title}</h4>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn("h-2 w-2 rounded-full", badge.color)} />
          <span className="text-xs text-muted-foreground">{badge.label}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {agentRole && <span className="bg-muted px-1.5 py-0.5 rounded">{agentRole}</span>}
        {creditsUsed !== undefined && <span>{creditsUsed} credits</span>}
        {duration && <span>{duration}</span>}
      </div>
    </div>
  );
}
