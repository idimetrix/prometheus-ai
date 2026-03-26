"use client";

import { cn } from "@prometheus/ui";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types ───────────────────────────────────────────────────

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface QueuedTask {
  agentRole?: string;
  completedAt?: string;
  createdAt: string;
  creditsConsumed?: number;
  description?: string;
  id: string;
  progress?: number;
  startedAt?: string;
  status: TaskStatus;
  title: string;
}

interface TaskQueueProps {
  className?: string;
  onCancelTask?: (taskId: string) => void;
  tasks: QueuedTask[];
}

// ── Status config ────────────────────────────────────────────

const STATUS_CONFIG: Record<
  TaskStatus,
  {
    color: string;
    icon: typeof CheckCircle2;
    label: string;
  }
> = {
  pending: {
    label: "Pending",
    color: "text-zinc-400",
    icon: Clock,
  },
  running: {
    label: "Running",
    color: "text-blue-400",
    icon: Loader2,
  },
  completed: {
    label: "Completed",
    color: "text-green-400",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    color: "text-red-400",
    icon: AlertCircle,
  },
  cancelled: {
    label: "Cancelled",
    color: "text-zinc-500",
    icon: XCircle,
  },
};

const ROLE_COLORS: Record<string, string> = {
  architect: "bg-indigo-500/20 text-indigo-400",
  frontend: "bg-cyan-500/20 text-cyan-400",
  backend: "bg-green-500/20 text-green-400",
  database: "bg-yellow-500/20 text-yellow-400",
  devops: "bg-orange-500/20 text-orange-400",
  testing: "bg-pink-500/20 text-pink-400",
  security: "bg-red-500/20 text-red-400",
  reviewer: "bg-violet-500/20 text-violet-400",
  designer: "bg-fuchsia-500/20 text-fuchsia-400",
};

// ── Helpers ──────────────────────────────────────────────────

function formatElapsed(startIso: string, endIso?: string): string {
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  const seconds = Math.floor(diffMs / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSecs = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSecs}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}h ${remainingMins}m`;
}

// ── Task Item ────────────────────────────────────────────────

function TaskItem({
  task,
  onCancel,
}: {
  onCancel?: (taskId: string) => void;
  task: QueuedTask;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [elapsed, setElapsed] = useState("");

  const config = STATUS_CONFIG[task.status];
  const StatusIcon = config.icon;
  const isActive = task.status === "pending" || task.status === "running";

  // Live elapsed timer
  useEffect(() => {
    if (!(task.startedAt || task.createdAt)) {
      return;
    }
    const ref = task.startedAt ?? task.createdAt;

    const update = () => {
      setElapsed(formatElapsed(ref, task.completedAt));
    };
    update();

    if (isActive) {
      const interval = setInterval(update, 1000);
      return () => clearInterval(interval);
    }
  }, [task.startedAt, task.createdAt, task.completedAt, isActive]);

  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-800 bg-zinc-900/50 transition-colors",
        isActive && "border-zinc-700"
      )}
    >
      {/* Header */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setIsExpanded(!isExpanded)}
        type="button"
      >
        {/* Expand chevron */}
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-zinc-600" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-zinc-600" />
        )}

        {/* Status icon */}
        <StatusIcon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            config.color,
            task.status === "running" && "animate-spin"
          )}
        />

        {/* Title */}
        <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">
          {task.title}
        </span>

        {/* Elapsed */}
        {elapsed && (
          <span className="shrink-0 font-mono text-[10px] text-zinc-600">
            {elapsed}
          </span>
        )}
      </button>

      {/* Progress bar for running tasks */}
      {task.status === "running" && task.progress !== undefined && (
        <div className="mx-3 mb-2 h-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-blue-500 transition-all duration-300"
            style={{ width: `${Math.min(100, Math.max(0, task.progress))}%` }}
          />
        </div>
      )}

      {/* Expanded details */}
      {isExpanded && (
        <div className="border-zinc-800 border-t px-3 py-2 text-[11px]">
          {/* Description */}
          {task.description && (
            <p className="mb-2 text-zinc-400">{task.description}</p>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Agent role badge */}
            {task.agentRole && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5",
                  ROLE_COLORS[task.agentRole] ?? "bg-zinc-500/20 text-zinc-400"
                )}
              >
                {task.agentRole}
              </span>
            )}

            {/* Credits consumed */}
            {task.creditsConsumed !== undefined && task.creditsConsumed > 0 && (
              <span className="text-zinc-600">
                Credits: {task.creditsConsumed}
              </span>
            )}

            {/* Status label */}
            <span className={cn("ml-auto", config.color)}>{config.label}</span>
          </div>

          {/* Cancel button */}
          {isActive && onCancel && (
            <button
              className="mt-2 rounded-md border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:border-red-500/50 hover:text-red-400"
              onClick={(e) => {
                e.stopPropagation();
                onCancel(task.id);
              }}
              type="button"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────

export function TaskQueue({ tasks, onCancelTask, className }: TaskQueueProps) {
  const grouped = useMemo(() => {
    const running: QueuedTask[] = [];
    const pending: QueuedTask[] = [];
    const completed: QueuedTask[] = [];

    for (const task of tasks) {
      if (task.status === "running") {
        running.push(task);
      } else if (task.status === "pending") {
        pending.push(task);
      } else {
        completed.push(task);
      }
    }

    return { running, pending, completed };
  }, [tasks]);

  const handleCancel = useCallback(
    (taskId: string) => {
      onCancelTask?.(taskId);
    },
    [onCancelTask]
  );

  const activeCount = grouped.running.length + grouped.pending.length;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-zinc-200">Task Queue</h3>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-400">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {activeCount} active
            </span>
          )}
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
            {tasks.length} total
          </span>
        </div>
      </div>

      {/* Running tasks */}
      {grouped.running.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Running
          </span>
          {grouped.running.map((task) => (
            <TaskItem key={task.id} onCancel={handleCancel} task={task} />
          ))}
        </div>
      )}

      {/* Pending tasks */}
      {grouped.pending.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Pending
          </span>
          {grouped.pending.map((task) => (
            <TaskItem key={task.id} onCancel={handleCancel} task={task} />
          ))}
        </div>
      )}

      {/* Completed tasks */}
      {grouped.completed.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            Completed
          </span>
          {grouped.completed.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {tasks.length === 0 && (
        <div className="flex h-20 items-center justify-center rounded-lg border border-zinc-800 border-dashed text-xs text-zinc-600">
          No tasks in queue
        </div>
      )}
    </div>
  );
}
